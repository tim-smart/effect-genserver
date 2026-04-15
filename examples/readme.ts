import { Effect, Layer, Schema } from "effect"
import { Rpc, RpcServer } from "effect/unstable/rpc"
import { ClusterGenServer, GenServer, RpcGenServer } from "effect-genserver"

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

// implementation
export const CounterLayer = Counter.toLayer(
  Effect.gen(function* () {
    yield* Effect.log("booting counter")
    const send = yield* Counter.sender

    // queue initial messages
    yield* send("increment", { amount: 1 })

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

// Derive a cluster entity
export const CounterEntity = ClusterGenServer.entity("Counter", Counter)

// Create the cluster implementation
export const CounterEntityLayer = CounterEntity.toLayer(
  ClusterGenServer.entityHandlers(Counter, CounterLayer),
)

// Derive a RpcGroup
export class CounterRpcGroup extends Counter.protocol {}

// Create the rpc handlers implementation
export const RpcHandlers = RpcGenServer.toRpcHandlers(Counter, CounterLayer)

// Create the rpc server
export const RpcServerLayer = RpcServer.layer(CounterRpcGroup).pipe(
  Layer.provide(RpcHandlers),
)
