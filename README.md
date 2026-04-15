# effect-genserver

Because I miss elixir

## Usage

```
pnpm add effect-genserver
```

```ts
import { Effect, Schema } from "effect"
import { Rpc } from "effect/unstable/rpc"
import { GenServer } from "effect-genserver"

// schema definition
export const Counter = GenServer.make({
  state: Schema.Struct({
    count: Schema.Int,
  }),
  protocol: [
    Rpc.make("increment", {
      payload: {
        amount: Schema.Int,
      },
    }),
    Rpc.make("decrement", {
      payload: {
        amount: Schema.Int,
      },
    }),
  ],
})

export const CounterLayer = Counter.toLayer(
  Effect.gen(function* () {
    yield* Effect.log("booting counter")
    const send = yield* Counter.sender

    yield* send("increment")

    return Counter.of(
      // initial state
      { count: 0 },
      // handlers
      {
        increment: Effect.fn("Counter.increment")(function* ({
          payload,
          state,
        }) {
          yield* Effect.log("incrementing counter")

          // handlers return a tuple of [new state, success value]
          return [
            {
              ...state,
              count: state.count + payload.amount,
            },
            void 0,
          ]
        }),
        decrement: Effect.fn("Counter.decrement")(function* ({
          payload,
          state,
        }) {
          yield* Effect.log("decrementing counter")
          return [
            {
              ...state,
              count: state.count - payload.amount,
            },
            void 0,
          ]
        }),
      },
    )
  }),
)
```
