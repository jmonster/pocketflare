//go:build js && wasm

// Package r2blob implements a blob.Driver backed by Cloudflare R2.
package r2blob

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"syscall/js"
	"time"

	"github.com/pocketbase/pocketbase/tools/filesystem/blob"
	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
	"github.com/syumai/workers/cloudflare"
)

// Driver implements blob.Driver backed by Cloudflare R2.
type Driver struct {
	bucket js.Value
}

// New creates a new R2-backed blob Driver bound to the given Workers binding name.
func New(bucketName string) *Driver {
	return &Driver{bucket: cloudflare.GetBinding(bucketName)}
}

// NormalizeError passes errors through unchanged.
func (d *Driver) NormalizeError(err error) error {
	return err
}

// Attributes returns metadata for the object at key.
// Returns blob.ErrNotFound if the object does not exist.
func (d *Driver) Attributes(ctx context.Context, key string) (*blob.Attributes, error) {
	p := d.bucket.Call("head", key)
	v, err := jsutil.AwaitPromise(ctx, p)
	if err != nil {
		return nil, err
	}
	if v.IsNull() {
		return nil, blob.ErrNotFound
	}
	return jsObjectToAttributes(v), nil
}

// ListPaged lists objects in the bucket with optional prefix/delimiter/cursor pagination.
func (d *Driver) ListPaged(ctx context.Context, opts *blob.ListOptions) (*blob.ListPage, error) {
	jsOpts := newJSObject()
	if opts.PageSize > 0 {
		jsOpts.Set("limit", opts.PageSize)
	}
	if opts.Prefix != "" {
		jsOpts.Set("prefix", opts.Prefix)
	}
	if opts.Delimiter != "" {
		jsOpts.Set("delimiter", opts.Delimiter)
	}
	if len(opts.PageToken) > 0 {
		jsOpts.Set("cursor", string(opts.PageToken))
	}

	p := d.bucket.Call("list", jsOpts)
	v, err := jsutil.AwaitPromise(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("r2 list: %w", err)
	}

	return jsValueToListPage(v), nil
}

// NewRangeReader returns a reader for the object at key, reading at most length
// bytes starting at offset. If length is negative, reads to the end of the object.
// Returns blob.ErrNotFound if the object does not exist.
func (d *Driver) NewRangeReader(ctx context.Context, key string, offset, length int64) (blob.DriverReader, error) {
	var p js.Value
	if offset == 0 && length == -1 {
		p = d.bucket.Call("get", key)
	} else {
		jsOpts := newJSObject()
		rangeOpts := newJSObject()
		rangeOpts.Set("offset", offset)
		if length >= 0 {
			rangeOpts.Set("length", length)
		}
		jsOpts.Set("range", rangeOpts)
		p = d.bucket.Call("get", key, jsOpts)
	}

	v, err := jsutil.AwaitPromise(ctx, p)
	if err != nil {
		return nil, err
	}
	if v.IsNull() {
		return nil, blob.ErrNotFound
	}

	body := convertReadableStreamToReadCloser(v.Get("body"))
	meta := httpMetadataFromJS(v.Get("httpMetadata"))
	uploaded, _ := dateToTime(v.Get("uploaded"))
	size := v.Get("size").Int()

	return &r2Reader{
		body:        body,
		contentType: meta.ContentType,
		modTime:     uploaded,
		size:        int64(size),
	}, nil
}

// NewTypedWriter returns a writer that buffers the full object in memory and
// uploads to R2 when Close is called.
func (d *Driver) NewTypedWriter(_ context.Context, key, contentType string, opts *blob.WriterOptions) (blob.DriverWriter, error) {
	return &r2Writer{
		driver:      d,
		key:         key,
		contentType: contentType,
		opts:        opts,
	}, nil
}

// Copy copies the object from srcKey to dstKey using a Get+Put fallback,
// since the Workers R2 bindings do not expose a server-side copy.
// Returns blob.ErrNotFound if the source does not exist.
func (d *Driver) Copy(ctx context.Context, dstKey, srcKey string) error {
	p := d.bucket.Call("get", srcKey)
	v, err := jsutil.AwaitPromise(ctx, p)
	if err != nil {
		return err
	}
	if v.IsNull() {
		return blob.ErrNotFound
	}

	body := convertReadableStreamToReadCloser(v.Get("body"))
	defer body.Close()

	data, err := io.ReadAll(body)
	if err != nil {
		return fmt.Errorf("r2 copy read: %w", err)
	}

	putOpts := newJSObject()
	httpMeta := v.Get("httpMetadata")
	if !httpMeta.IsUndefined() && !httpMeta.IsNull() {
		putOpts.Set("httpMetadata", httpMeta)
	}

	ua := newUint8Array(len(data))
	js.CopyBytesToJS(ua, data)
	p2 := d.bucket.Call("put", dstKey, ua.Get("buffer"), putOpts)
	_, err = jsutil.AwaitPromise(ctx, p2)
	if err != nil {
		return fmt.Errorf("r2 copy write: %w", err)
	}
	return nil
}

// Delete removes the object at key.
func (d *Driver) Delete(ctx context.Context, key string) error {
	p := d.bucket.Call("delete", key)
	_, err := jsutil.AwaitPromise(ctx, p)
	return err
}

// Close is a no-op for R2.
func (d *Driver) Close() error {
	return nil
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

// r2Reader wraps an R2 object body as a blob.DriverReader.
type r2Reader struct {
	body        io.ReadCloser
	contentType string
	modTime     time.Time
	size        int64
}

func (r *r2Reader) Read(p []byte) (int, error)  { return r.body.Read(p) }
func (r *r2Reader) Close() error                 { return r.body.Close() }
func (r *r2Reader) Attributes() *blob.ReaderAttributes {
	return &blob.ReaderAttributes{
		ContentType: r.contentType,
		ModTime:     r.modTime,
		Size:        r.size,
	}
}

// r2Writer buffers writes and uploads to R2 on Close.
type r2Writer struct {
	driver      *Driver
	key         string
	contentType string
	opts        *blob.WriterOptions
	buf         bytes.Buffer
}

func (w *r2Writer) Write(p []byte) (int, error) { return w.buf.Write(p) }

func (w *r2Writer) Close() error {
	data := w.buf.Bytes()
	ua := newUint8Array(len(data))
	js.CopyBytesToJS(ua, data)

	putOpts := newJSObject()

	// Map HTTP metadata from the WriterOptions.
	httpMeta := newJSObject()
	if w.contentType != "" {
		httpMeta.Set("contentType", w.contentType)
	}
	if w.opts != nil {
		if w.opts.CacheControl != "" {
			httpMeta.Set("cacheControl", w.opts.CacheControl)
		}
		if w.opts.ContentDisposition != "" {
			httpMeta.Set("contentDisposition", w.opts.ContentDisposition)
		}
		if w.opts.ContentEncoding != "" {
			httpMeta.Set("contentEncoding", w.opts.ContentEncoding)
		}
		if w.opts.ContentLanguage != "" {
			httpMeta.Set("contentLanguage", w.opts.ContentLanguage)
		}
		if len(w.opts.Metadata) > 0 {
			customMeta := make(map[string]any, len(w.opts.Metadata))
			for k, v := range w.opts.Metadata {
				customMeta[k] = v
			}
			putOpts.Set("customMetadata", customMeta)
		}
		if len(w.opts.ContentMD5) > 0 {
			putOpts.Set("md5", string(w.opts.ContentMD5))
		}
	}
	putOpts.Set("httpMetadata", httpMeta)

	p := w.driver.bucket.Call("put", w.key, ua.Get("buffer"), putOpts)
	_, err := jsutil.AwaitPromise(context.Background(), p)
	return err
}

// httpMetadataFields extracts HTTP metadata from a JS R2 object's httpMetadata value.
type httpMetadataFields struct {
	ContentType        string
	ContentLanguage    string
	ContentDisposition string
	ContentEncoding    string
	CacheControl       string
	CacheExpiry        time.Time
}

// newJSObject creates a new JavaScript Object.
func newJSObject() js.Value {
	return js.Global().Get("Object").New()
}

// newUint8Array creates a new JavaScript Uint8Array of the given length.
func newUint8Array(length int) js.Value {
	return js.Global().Get("Uint8Array").New(length)
}

// maybeString returns the string value of v, or "" if undefined/null.
func maybeString(v js.Value) string {
	if v.IsUndefined() || v.IsNull() {
		return ""
	}
	return v.String()
}

// dateToTime converts a JavaScript Date value to time.Time.
func dateToTime(v js.Value) (time.Time, error) {
	if v.IsUndefined() || v.IsNull() {
		return time.Time{}, fmt.Errorf("date value is undefined or null")
	}
	ms := v.Call("getTime").Int()
	return time.UnixMilli(int64(ms)), nil
}

// maybeDate converts a JavaScript Date value to time.Time, or returns zero time if undefined.
func maybeDate(v js.Value) (time.Time, error) {
	if v.IsUndefined() || v.IsNull() {
		return time.Time{}, nil
	}
	return dateToTime(v)
}

// strRecordToMap converts a JavaScript Object used as a string record to a Go map.
func strRecordToMap(v js.Value) map[string]string {
	if v.IsUndefined() || v.IsNull() {
		return nil
	}
	keys := js.Global().Get("Object").Call("keys", v)
	m := make(map[string]string, keys.Length())
	for i := 0; i < keys.Length(); i++ {
		key := keys.Index(i).String()
		m[key] = v.Get(key).String()
	}
	return m
}

// readableStreamToReadCloser wraps a JavaScript ReadableStream as an io.ReadCloser.
type readableStreamToReadCloser struct {
	stream js.Value
	reader js.Value
}

func convertReadableStreamToReadCloser(stream js.Value) io.ReadCloser {
	if stream.IsUndefined() || stream.IsNull() {
		return io.NopCloser(strings.NewReader(""))
	}
	reader := stream.Call("getReader")
	return &readableStreamToReadCloser{stream: stream, reader: reader}
}

func (r *readableStreamToReadCloser) Read(p []byte) (n int, err error) {
	promise := r.reader.Call("read")
	result, err := jsutil.AwaitPromise(context.Background(), promise)
	if err != nil {
		return 0, err
	}
	done := result.Get("done")
	if !done.IsUndefined() && done.Bool() {
		return 0, io.EOF
	}
	chunk := result.Get("value")
	if chunk.IsUndefined() || chunk.IsNull() {
		return 0, io.EOF
	}
	// chunk is an ArrayBuffer or typed array
	length := chunk.Get("byteLength").Int()
	if length > len(p) {
		length = len(p)
	}
	// Create a Uint8Array view of the chunk and copy bytes
	tmp := js.Global().Get("Uint8Array").New(chunk)
	n = js.CopyBytesToGo(p[:length], tmp)
	return n, nil
}

func (r *readableStreamToReadCloser) Close() error {
	promise := r.reader.Call("cancel")
	_, err := jsutil.AwaitPromise(context.Background(), promise)
	return err
}

// ---------------------------------------------------------------------------
// R2 type conversion helpers
// ---------------------------------------------------------------------------

func httpMetadataFromJS(v js.Value) httpMetadataFields {
	if v.IsUndefined() || v.IsNull() {
		return httpMetadataFields{}
	}
	cacheExpiry, _ := maybeDate(v.Get("cacheExpiry"))
	return httpMetadataFields{
		ContentType:        maybeString(v.Get("contentType")),
		ContentLanguage:    maybeString(v.Get("contentLanguage")),
		ContentDisposition: maybeString(v.Get("contentDisposition")),
		ContentEncoding:    maybeString(v.Get("contentEncoding")),
		CacheControl:       maybeString(v.Get("cacheControl")),
		CacheExpiry:        cacheExpiry,
	}
}

// jsObjectToAttributes converts a JS R2 Object value to blob.Attributes.
func jsObjectToAttributes(v js.Value) *blob.Attributes {
	uploaded, _ := dateToTime(v.Get("uploaded"))
	meta := httpMetadataFromJS(v.Get("httpMetadata"))
	size := v.Get("size").Int()

	return &blob.Attributes{
		ContentType:        meta.ContentType,
		ContentLanguage:    meta.ContentLanguage,
		ContentDisposition: meta.ContentDisposition,
		ContentEncoding:    meta.ContentEncoding,
		CacheControl:       meta.CacheControl,
		ModTime:            uploaded,
		CreateTime:         uploaded,
		Size:               int64(size),
		ETag:               maybeString(v.Get("etag")),
		Metadata:           strRecordToMap(v.Get("customMetadata")),
	}
}

// jsValueToListPage converts a JS R2 list() result to blob.ListPage.
func jsValueToListPage(v js.Value) *blob.ListPage {
	objectsVal := v.Get("objects")
	prefixesVal := v.Get("delimitedPrefixes")
	totalCap := objectsVal.Length() + prefixesVal.Length()
	objects := make([]*blob.ListObject, 0, totalCap)

	for i := 0; i < objectsVal.Length(); i++ {
		obj := objectsVal.Index(i)
		uploaded, _ := dateToTime(obj.Get("uploaded"))
		size := obj.Get("size").Int()

		objects = append(objects, &blob.ListObject{
			Key:     obj.Get("key").String(),
			ModTime: uploaded,
			Size:    int64(size),
		})
	}

	for i := 0; i < prefixesVal.Length(); i++ {
		objects = append(objects, &blob.ListObject{
			Key:   prefixesVal.Index(i).String(),
			IsDir: true,
		})
	}

	var nextPageToken []byte
	if v.Get("truncated").Bool() {
		if cursor := maybeString(v.Get("cursor")); cursor != "" {
			nextPageToken = []byte(cursor)
		}
	}

	return &blob.ListPage{
		Objects:       objects,
		NextPageToken: nextPageToken,
	}
}
