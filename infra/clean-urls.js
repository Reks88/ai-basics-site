// CloudFront Function (viewer request) — gives ai-basics.org clean URLs.
//
//   /glossary        -> /glossary.html
//   /chapter3        -> /chapter3.html
//   /                -> untouched (default root object handles it)
//   /og-cover.png    -> untouched (has an extension)
//   /some/dir/       -> /some/dir/index.html
//
// Runtime: cloudfront-js-2.0. Deployed by infra/harden.py clean-urls.

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Directory-style paths get index.html.
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  // Anything with a file extension in its last segment is already a real
  // object — leave it alone. Checking only the last segment means a path
  // like /v1.2/intro still gets .html appended.
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = uri + '.html';
  }

  return request;
}
