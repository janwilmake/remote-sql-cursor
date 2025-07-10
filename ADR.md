# Authentication

I've considered to add authentication as required option into the `@Streamable` decorator, but this is impractical for the most common usecase where we just want to perform queries from the worker since it requires an additional parameter to `exec` besides the stub.

That said, it's dangerous because not adding auth and exposing your entire DO to the outside world will go unnoticed. There are 2 main ways of using `/query/stream`:

1. using `exec` in the worker with the cloudflare stub
2. exposing the worker to the outside world and accessing `/query/raw` directly or also via `exec` with `makeStub`.

The latter is can easily be done accidentally.

In the end, I decided on adding an `authentication` property that is required for external requests. We cannot perfectly protect for all human stupidity anyways.

# Reloading local server...

This often happens locally, which isn't great since DORM relies on this library. Even after exchanging TransformerStream with ReadableStream this problem didn't resolve.
