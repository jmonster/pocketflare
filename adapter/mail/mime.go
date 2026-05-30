package mail

import (
	"bytes"
	"io"

	"github.com/gabriel-vasile/mimetype"
)

// detectMimeType reads the first bytes of r to detect the MIME type,
// returning a new reader that yields the full data.
func detectMimeType(r io.Reader) (io.Reader, string, error) {
	var buf bytes.Buffer
	mime, err := mimetype.DetectReader(io.TeeReader(r, &buf))
	if err != nil {
		return nil, "", err
	}
	return io.MultiReader(&buf, r), mime.String(), nil
}
