/**
 * @since 1.0.0
 */
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as Context from "effect/Context"
import type * as RpcSchema from "effect/unstable/rpc/RpcSchema"
import * as Entity from "effect/unstable/cluster/Entity"
import type * as Envelope from "effect/unstable/cluster/Envelope"
import * as GenServer from "./GenServer.ts"
import * as Stream from "effect/Stream"

/**
 * @since 1.0.0
 * @category Entity
 */
export const entity = <
  const Type extends string,
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
>(
  type: Type,
  schema: GenServer.GenServer<State, Rpcs>,
): [State] extends [GenServer.InMemory<any>]
  ? "In-memory state cannot be used for cluster entities"
  : Entity.Entity<
      Type,
      | Rpcs
      | Rpc.Rpc<
          "GenServerChanges",
          Schema.Void,
          RpcSchema.Stream<State, Schema.Never>
        >
    > =>
  Entity.fromRpcGroup(
    type,
    schema.protocol.add(GenServer.RpcStateChanges(schema)),
  ) as any

/**
 * @since 1.0.0
 * @category Entity
 */
export type EntityHandlersFrom<Rpcs extends Rpc.Any> = {
  readonly [Current in Rpcs as Current["_tag"]]: (
    envelope: Envelope.Request<Current>,
  ) => Rpc.WrapperOr<Rpc.ResultFrom<Current, never>>
}

/**
 * @since 1.0.0
 * @category Entity
 */
export const entityHandlers = Effect.fnUntraced(function* <
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
  E,
  R,
>(
  schema: GenServer.GenServer<State, Rpcs>,
  layer: Layer.Layer<GenServer.ToHandler<Rpcs> | GenServer.InitialState, E, R>,
): Effect.fn.Return<
  EntityHandlersFrom<
    | Rpcs
    | Rpc.Rpc<
        "GenServerChanges",
        Schema.Void,
        RpcSchema.Stream<State, Schema.Never>
      >
  >,
  E,
  Exclude<R, GenServer.SendDiscard> | Scope.Scope
> {
  const { handlers } = yield* GenServer.makeHandlers(schema, layer)
  const entityHandlers: Record<
    string,
    (request: Envelope.Request<any>) => any
  > = {}
  for (const { rpc, handler } of handlers.values()) {
    entityHandlers[rpc._tag] = (request: Envelope.Request<any>) => {
      const result = handler({
        payload: request.payload,
        context: ClusterRequest.context(request),
      })
      return Stream.isStream(result) ? Rpc.fork(result) : result
    }
  }
  return entityHandlers as any
})

/**
 * @since 1.0.0
 * @category Entity
 */
export class ClusterRequest extends Context.Service<
  ClusterRequest,
  Envelope.Request<Rpc.AnyWithProps>
>()("effect-genserver/ClusterGenServer/ClusterRequest") {}
