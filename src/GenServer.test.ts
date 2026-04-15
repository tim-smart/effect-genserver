import { describe, expect, it } from "@effect/vitest"
import * as GenServer from "./GenServer.ts"
import { Effect, Fiber, pipe, Schema, Stream } from "effect"
import { Rpc } from "effect/unstable/rpc"

const Counter = GenServer.make({
  state: Schema.Int,
  protocol: [
    Rpc.make("increment"),
    Rpc.make("count", {
      success: Schema.String,
      stream: true,
    }),
  ],
})

const CounterLayer = Counter.toLayer(
  Effect.gen(function* () {
    yield* Effect.void
    return Counter.of(0, {
      increment: ({ state }) => Effect.succeed([state + 1, void 0]),
      count: ({ changes }) => changes.pipe(Stream.map((a) => a.toString())),
    })
  }),
)

describe("GenServer", () => {
  it.effect(
    "handles streams",
    Effect.fn(function* () {
      const actor = yield* GenServer.makeActor(Counter, CounterLayer)
      const arr = yield* pipe(
        actor.send("count"),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild({ startImmediately: true }),
      )
      yield* actor.send("increment")
      yield* actor.send("increment")
      expect(yield* Fiber.join(arr)).toEqual(["0", "1", "2"])
    }),
  )
})
