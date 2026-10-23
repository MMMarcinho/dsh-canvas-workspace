import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativePathImages,
  resolveNativeImageResource,
} from "../src/host/native-images";

test("native image paths resolve against the owning session on Web and App", () => {
  for (const base of ["http://localhost:3000/", "dsh-app://app/"]) {
    const resolve = createNativePathImages(base, "/Users/example/art").resolve;
    const image = resolve("posters/cover.png");
    assert.equal(new URL(image!).pathname, "/api/file");
    assert.equal(
      new URL(image!).searchParams.get("path"),
      "/Users/example/art/posters/cover.png",
    );
    assert.equal(
      new URL(resolve("./封面%20图.png?size=2#preview")!).searchParams.get(
        "path",
      ),
      "/Users/example/art/./封面 图.png",
    );
    assert.equal(
      new URL(resolve("/tmp/graph.png")!).searchParams.get("path"),
      "/tmp/graph.png",
    );
  }
});

test("native image resolver rejects unsafe protocols, shares, escapes and missing cwd", () => {
  const resolve = createNativePathImages(
    "dsh-app://app/",
    "/workspace",
  ).resolve;
  for (const path of [
    "javascript:alert(1)",
    "file:///tmp/a.png",
    "data:image/png;base64,AAAA",
    "dsh-app://app/api/file?path=/tmp/a.png",
    "//evil/a.png",
    "\\\\host\\a.png",
    "%2F%2Fevil/a.png",
    "%00x.png",
    "bad%GG.png",
    "https://evil/a.png",
    "",
  ])
    assert.equal(resolve(path), undefined, path);
  assert.equal(
    createNativePathImages("dsh-app://shell/", "/workspace").resolve("a.png"),
    undefined,
  );
  assert.equal(
    createNativePathImages("dsh-app://app.evil/", "/workspace").resolve(
      "a.png",
    ),
    undefined,
  );
  assert.equal(
    createNativePathImages("http://localhost/").resolve("a.png"),
    undefined,
  );
  assert.ok(createNativePathImages("http://localhost/").resolve("/tmp/a.png"));
});

test("IUI accepts explicit local or remote images, not prose searches", async () => {
  const resolve = (query: unknown, cwd: string | undefined = "/art") =>
    resolveNativeImageResource("dsh-app://app/", cwd, {
      kind: "AsyncImage",
      query,
    });
  const local = await resolve("posters/封面.png");
  assert.equal(local.ok, true);
  assert.equal(local.value?.alt, "封面.png");
  assert.equal(
    new URL(local.value!.src).searchParams.get("path"),
    "/art/posters/封面.png",
  );
  const remote = await resolve("https://example.com/img?id=1");
  assert.equal(remote.value?.src, "https://example.com/img?id=1");
  for (const query of [
    "cyberpunk poster",
    "javascript:bad.png",
    "file:///tmp/a.png",
    "dsh-app://app/api/file?path=/tmp/a.png",
    "https://user:secret@example.com/a.png",
    "https://",
    "//host/a.png",
    null,
  ])
    assert.equal((await resolve(query)).ok, false, String(query));
  assert.equal(
    (
      await resolveNativeImageResource("http://localhost/", undefined, {
        kind: "AsyncImage",
        query: "a.png",
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await resolveNativeImageResource("http://localhost/", "/art", {
        kind: "AsyncVideo",
        query: "a.png",
      })
    ).ok,
    false,
  );
});
