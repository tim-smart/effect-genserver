/**
 * @since 1.0.0
 */
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import type * as RpcMessage from "effect/unstable/rpc/RpcMessage"
import type * as Headers from "effect/unstable/http/Headers"
import * as GenServer from "./GenServer.ts"
import * as Stream from "effect/Stream"

/**
 * @since 1.0.0
 * @category RpcServer
 */
export const toRpcHandlers = <
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
  E,
  R,
>(
  schema: GenServer.GenServer<State, Rpcs>,
  layer: Layer.Layer<GenServer.ToHandler<Rpcs> | GenServer.InitialState, E, R>,
): [State] extends [GenServer.InMemory<any>]
  ? "In-memory state cannot be used for RPC"
  : Layer.Layer<
      Rpc.ToHandler<Rpcs> | Rpc.Handler<"GenServerChanges">,
      E,
      Exclude<R, GenServer.SendDiscard>
    > =>
  Layer.effectContext(
    Effect.gen(function* () {
      const { handlers } = yield* GenServer.makeHandlers(schema, layer)
      const contextMap = new Map<string, Rpc.Handler<string>>()
      const services = yield* Effect.context()

      for (const { rpc, handler } of handlers.values()) {
        contextMap.set(rpc.key, {
          _: null as any,
          tag: rpc._tag,
          context: services,
          handler(payload, options): any {
            const result = handler({
              payload,
              context: RpcContext.context(options as any),
            }) as Stream.Stream<any, any> | Effect.Effect<any, any>
            return Stream.isStream(result) ? Rpc.fork(result) : result
          },
        })
      }

      return Context.makeUnsafe(contextMap)
    }),
  ) as any

/**
 * @since 1.0.0
 * @category RpcServer
 */
export class RpcContext extends Context.Service<
  RpcContext,
  {
    readonly client: Rpc.ServerClient
    readonly requestId: RpcMessage.RequestId
    readonly headers: Headers.Headers
    readonly rpc: Rpc.AnyWithProps
  }
>()("effect-genserver/RpcGenServer/RpcContext") {}
