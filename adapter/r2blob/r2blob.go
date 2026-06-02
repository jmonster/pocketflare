//go:build js && wasm

// Package r2blob implements a blob.Driver backed by Cloudflare R2.
package r2blob

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"syscall/js"
	"time"

	"github.com/pocketbase/pocketbase/tools/filesystem/blob"
	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
	"github.com/pocketflare/pocketflare/adapter/r2blob/s3sig"
	"github.com/syumai/workers/cloudflare"
)

const r2PartSize = 10 * 1024 * 1024 // 10 MiB

// Driver implements blob.Driver backed by Cloudflare R2.
type Driver struct {
	bucket     js.Value
	bucketName string // actual R2 bucket name for S3 API calls
}

// New creates a new R2-backed blob Driver.
// bindingName is the Workers binding name (e.g. "STORAGE").
// bucketName is the actual R2 bucket name (e.g. "pocketflare-storage"), used
// for S3 CopyObject API calls. It must match the bucket_name in wrangler.toml.
func New(bindingName, bucketName string) *Driver {
	return &Driver{
		bucket:     cloudflare.GetBinding(bindingName),
		bucketName: bucketName,
	}
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

// NewTypedWriter returns a writer that streams data to R2 using multipart
// upload. Files smaller than r2PartSize fall back to a single put() on Close.
func (d *Driver) NewTypedWriter(ctx context.Context, key, contentType string, opts *blob.WriterOptions) (blob.DriverWriter, error) {
	return &r2Writer{
		ctx:         ctx,
		driver:      d,
		key:         key,
		contentType: contentType,
		opts:        opts,
	}, nil
}

// Copy copies srcKey to dstKey. Uses server-side S3 CopyObject when R2 API
// credentials are configured; otherwise streams via FixedLengthStream (no
// Go-side buffering).
func (d *Driver) Copy(ctx context.Context, dstKey, srcKey string) error {
	accessKey := cloudflare.Getenv("R2_ACCESS_KEY_ID")
	secretKey := cloudflare.Getenv("R2_SECRET_ACCESS_KEY")
	accountID := cloudflare.Getenv("R2_ACCOUNT_ID")
	sessionToken := cloudflare.Getenv("R2_SESSION_TOKEN")

	if accessKey != "" && secretKey != "" && accountID != "" {
		return d.s3CopyObject(ctx, dstKey, srcKey, accessKey, secretKey, accountID, sessionToken)
	}

	copyFallbackOnce.Do(func() {
		log.Print("r2blob: R2 API credentials not set; copies will stream through Worker " +
			"(set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID for server-side CopyObject)")
	})
	return d.streamingCopy(ctx, dstKey, srcKey)
}

var copyFallbackOnce sync.Once

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

// r2Writer streams data to R2 using multipart upload.
// Files under r2PartSize fall back to a single put() on Close.
type r2Writer struct {
	ctx         context.Context
	driver      *Driver
	key         string
	contentType string
	opts        *blob.WriterOptions

	upload     js.Value   // R2MultipartUpload, nil until first flush
	partNumber int
	parts      []js.Value // accumulated R2UploadedPart values

	buf       bytes.Buffer
	totalSize int64
}

func (w *r2Writer) Write(p []byte) (int, error) {
	w.totalSize += int64(len(p))
	n, err := w.buf.Write(p)
	if err != nil {
		return n, err
	}
	if w.buf.Len() >= r2PartSize {
		if err := w.flushPart(); err != nil {
			return n, err
		}
	}
	return n, nil
}

func (w *r2Writer) flushPart() error {
	if w.buf.Len() == 0 {
		return nil
	}

	if w.upload.IsUndefined() || w.upload.IsNull() {
		putOpts := buildPutOpts(w.contentType, w.opts)
		p := w.driver.bucket.Call("createMultipartUpload", w.key, putOpts)
		upload, err := jsutil.AwaitPromise(w.ctx, p)
		if err != nil {
			return fmt.Errorf("r2 createMultipartUpload: %w", err)
		}
		w.upload = upload
		w.partNumber = 0
	}

	w.partNumber++
	data := w.buf.Bytes()
	ua := newUint8Array(len(data))
	js.CopyBytesToJS(ua, data)

	p := w.upload.Call("uploadPart", w.partNumber, ua.Get("buffer"))
	result, err := jsutil.AwaitPromise(w.ctx, p)
	if err != nil {
		go w.abortUpload()
		return fmt.Errorf("r2 uploadPart %d: %w", w.partNumber, err)
	}
	w.parts = append(w.parts, result)
	w.buf.Reset()
	return nil
}

func (w *r2Writer) Close() error {
	defer w.buf.Reset()

	if w.totalSize == 0 && (w.upload.IsUndefined() || w.upload.IsNull()) {
		return w.singlePut([]byte{})
	}

	// Small file fast path: everything fits in one buffer.
	if w.upload.IsUndefined() || w.upload.IsNull() {
		return w.singlePut(w.buf.Bytes())
	}

	// Flush final part (may be smaller than 5 MiB — allowed for the last part).
	if w.buf.Len() > 0 {
		if err := w.flushPart(); err != nil {
			return err
		}
	}

	return w.completeUpload()
}

func (w *r2Writer) singlePut(data []byte) error {
	ua := newUint8Array(len(data))
	js.CopyBytesToJS(ua, data)
	putOpts := buildPutOpts(w.contentType, w.opts)
	p := w.driver.bucket.Call("put", w.key, ua.Get("buffer"), putOpts)
	_, err := jsutil.AwaitPromise(w.ctx, p)
	return err
}

func (w *r2Writer) completeUpload() error {
	partsArray := js.Global().Get("Array").New(len(w.parts))
	for i, p := range w.parts {
		partsArray.SetIndex(i, p)
	}
	p := w.upload.Call("complete", partsArray)
	_, err := jsutil.AwaitPromise(w.ctx, p)
	if err != nil {
		go w.abortUpload()
		return fmt.Errorf("r2 complete multipart: %w", err)
	}
	return nil
}

// abortUpload calls abort on the multipart upload. Runs in a goroutine with a
// background context so cancellation doesn't prevent cleanup.
func (w *r2Writer) abortUpload() {
	if w.upload.IsUndefined() || w.upload.IsNull() {
		return
	}
	p := w.upload.Call("abort")
	jsutil.AwaitPromise(context.Background(), p) // best effort
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

// s3CopyObject performs a server-side copy via the R2 S3 HTTP API.
// Zero data flows through the Worker.
func (d *Driver) s3CopyObject(ctx context.Context, dstKey, srcKey string, accessKey, secretKey, accountID, sessionToken string) error {
	host := accountID + ".r2.cloudflarestorage.com"
	path := s3sig.CanonicalURI(d.bucketName + "/" + dstKey)
	srcPath := s3sig.CanonicalURI(d.bucketName + "/" + srcKey)

	now := time.Now()
	payloadSHA := s3sig.EmptyPayloadHash()
	extraHeaders := map[string]string{"x-amz-copy-source": srcPath}
	if sessionToken != "" {
		extraHeaders["x-amz-security-token"] = sessionToken
	}

	auth := s3sig.Sign(
		accessKey, secretKey, "auto", "s3", now,
		"PUT", host, path,
		extraHeaders,
		payloadSHA,
	)

	url := "https://" + host + path

	fetchOpts := newJSObject()
	fetchOpts.Set("method", "PUT")

	headers := newJSObject()
	headers.Set("x-amz-date", now.Format("20060102T150405Z"))
	headers.Set("x-amz-content-sha256", payloadSHA)
	headers.Set("x-amz-copy-source", srcPath)
	if sessionToken != "" {
		headers.Set("x-amz-security-token", sessionToken)
	}
	headers.Set("Authorization", auth)
	fetchOpts.Set("headers", headers)

	promise := js.Global().Call("fetch", url, fetchOpts)
	resp, err := jsutil.AwaitPromise(ctx, promise)
	if err != nil {
		return fmt.Errorf("s3 copy fetch: %w", err)
	}

	status := resp.Get("status").Int()
	if status == 200 {
		return nil
	}
	if status == 404 {
		return blob.ErrNotFound
	}

	body, _ := jsutil.AwaitPromise(ctx, resp.Call("text"))
	return fmt.Errorf("s3 copy: HTTP %d: %s", status, body.String())
}

// streamingCopy copies via FixedLengthStream Get+Put. No Go buffering; data
// streams through the Worker.
func (d *Driver) streamingCopy(ctx context.Context, dstKey, srcKey string) error {
	p := d.bucket.Call("get", srcKey)
	v, err := jsutil.AwaitPromise(ctx, p)
	if err != nil {
		return err
	}
	if v.IsNull() {
		return blob.ErrNotFound
	}

	body := v.Get("body")

	// FixedLengthStream gives the ReadableStream a known length, satisfying
	// put()'s requirement. Without this, R2 put would reject the body from
	// get() with "readable stream must have a known length."
	// Ref: https://github.com/cloudflare/workers-sdk/issues/6425
	sizeVal := v.Get("size").Int()
	fls := js.Global().Get("FixedLengthStream").New(sizeVal)
	pipePromise := body.Call("pipeTo", fls.Get("writable"))
	readable := fls.Get("readable")

	putOpts := copyPutOpts(v)
	p2 := d.bucket.Call("put", dstKey, readable, putOpts)
	_, err = jsutil.AwaitPromise(ctx, p2)
	if err != nil {
		return fmt.Errorf("r2 streaming copy write: %w", err)
	}
	// Surface source-stream failures that the put may have consumed
	// successfully but were errors nonetheless.
	if _, err := jsutil.AwaitPromise(ctx, pipePromise); err != nil {
		return fmt.Errorf("r2 streaming copy pipe: %w", err)
	}
	return nil
}

// copyPutOpts builds putOpts from a source R2Object, preserving httpMetadata
// and customMetadata on the destination.
func copyPutOpts(src js.Value) js.Value {
	putOpts := newJSObject()
	if httpMeta := src.Get("httpMetadata"); !httpMeta.IsUndefined() && !httpMeta.IsNull() {
		putOpts.Set("httpMetadata", httpMeta)
	}
	if customMeta := src.Get("customMetadata"); !customMeta.IsUndefined() && !customMeta.IsNull() {
		putOpts.Set("customMetadata", customMeta)
	}
	return putOpts
}

// buildPutOpts constructs a JS R2PutOptions object from Go-level writer params.
func buildPutOpts(contentType string, opts *blob.WriterOptions) js.Value {
	putOpts := newJSObject()
	httpMeta := newJSObject()
	if contentType != "" {
		httpMeta.Set("contentType", contentType)
	}
	if opts != nil {
		if opts.CacheControl != "" {
			httpMeta.Set("cacheControl", opts.CacheControl)
		}
		if opts.ContentDisposition != "" {
			httpMeta.Set("contentDisposition", opts.ContentDisposition)
		}
		if opts.ContentEncoding != "" {
			httpMeta.Set("contentEncoding", opts.ContentEncoding)
		}
		if opts.ContentLanguage != "" {
			httpMeta.Set("contentLanguage", opts.ContentLanguage)
		}
		if len(opts.Metadata) > 0 {
			customMeta := make(map[string]any, len(opts.Metadata))
			for k, v := range opts.Metadata {
				customMeta[k] = v
			}
			putOpts.Set("customMetadata", customMeta)
		}
		if len(opts.ContentMD5) > 0 {
			putOpts.Set("md5", string(opts.ContentMD5))
		}
	}
	putOpts.Set("httpMetadata", httpMeta)
	return putOpts
}

// ---------------------------------------------------------------------------
// JS interop helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ReadableStream bridge
// ---------------------------------------------------------------------------

// readableStreamToReadCloser wraps a JavaScript ReadableStream as an io.ReadCloser.
type readableStreamToReadCloser struct {
	stream js.Value
	reader js.Value
	buf    []byte // unconsumed bytes from the current JS chunk
}

func convertReadableStreamToReadCloser(stream js.Value) io.ReadCloser {
	if stream.IsUndefined() || stream.IsNull() {
		return io.NopCloser(strings.NewReader(""))
	}
	reader := stream.Call("getReader")
	return &readableStreamToReadCloser{stream: stream, reader: reader}
}

func (r *readableStreamToReadCloser) Read(p []byte) (n int, err error) {
	// Drain buffered data from a previous chunk first.
	if len(r.buf) > 0 {
		n = copy(p, r.buf)
		r.buf = r.buf[n:]
		return n, nil
	}

	promise := r.reader.Call("read")
	result, err := jsutil.AwaitPromise(context.Background(), promise)
	if err != nil {
		return 0, err
	}
	if done := result.Get("done"); !done.IsUndefined() && done.Bool() {
		return 0, io.EOF
	}
	chunk := result.Get("value")
	if chunk.IsUndefined() || chunk.IsNull() {
		return 0, io.EOF
	}

	// Copy the entire JS chunk into a Go-owned buffer so bytes are never
	// lost when len(p) is smaller than the chunk.
	length := chunk.Get("byteLength").Int()
	if length > 0 {
		tmp := js.Global().Get("Uint8Array").New(chunk)
		r.buf = make([]byte, length)
		js.CopyBytesToGo(r.buf, tmp)
	}

	// Drain into caller's buffer.
	n = copy(p, r.buf)
	r.buf = r.buf[n:]
	return n, nil
}

func (r *readableStreamToReadCloser) Close() error {
	r.buf = nil
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

// httpMetadataFields extracts HTTP metadata from a JS R2 object's httpMetadata value.
type httpMetadataFields struct {
	ContentType        string
	ContentLanguage    string
	ContentDisposition string
	ContentEncoding    string
	CacheControl       string
	CacheExpiry        time.Time
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
