/**
 * @since 1.0.0
 */
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import * as Context from "effect/Context"
import type * as Option from "effect/Option"
import * as Persistence from "effect/unstable/persistence/Persistence"
import * as PubSub from "effect/PubSub"
import * as MutableRef from "effect/MutableRef"
import * as Stream from "effect/Stream"
import * as Semaphore from "effect/Semaphore"
import { flow, identity, pipe } from "effect/Function"
import * as RpcSchema from "effect/unstable/rpc/RpcSchema"
import * as Latch from "effect/Latch"
import type { Types } from "effect"

/**
 * @since 1.0.0
 * @category Models
 */
export interface GenServer<State extends Schema.Top, Rpcs extends Rpc.Any> {
  readonly stateSchema: State
  readonly protocol: RpcGroup.RpcGroup<Rpcs>

  readonly sender: Effect.Effect<
    <
      const Tag extends Rpcs["_tag"],
      Rpc = Rpc.ExtractTag<Rpcs, Tag>,
      Payload = Rpc.PayloadConstructor<Rpc>,
    >(
      tag: Tag,
      ...args: Types.EqualsWith<
        Payload,
        void,
        [payload?: Payload],
        [payload: Payload]
      >
    ) => Effect.Effect<void>,
    never,
    SendDiscard
  >

  of<A extends Handlers<State, Rpcs>>(
    initialState: State["Type"],
    handlers: A,
  ): readonly [state: State["Type"], handlers: A]

  toLayer<A extends Handlers<State, Rpcs>, E, R>(
    build: Effect.Effect<readonly [state: State["Type"], handlers: A], E, R>,
  ): Layer.Layer<
    ToHandler<Rpcs> | InitialState,
    E,
    Exclude<R, Scope.Scope> | HandlerServices<A>
  >

  toLayerPersisted<A extends Handlers<State, Rpcs>, E, R>(
    build: (
      getPersistedState: (
        id: string,
      ) => Effect.Effect<
        Option.Option<State["Type"]>,
        Persistence.PersistenceError,
        State["DecodingServices"]
      >,
    ) => Effect.Effect<readonly [state: State["Type"], handlers: A], E, R>,
  ): Layer.Layer<
    ToHandler<Rpcs> | InitialState,
    E,
    | Exclude<R, Scope.Scope>
    | HandlerServices<A>
    | Persistence.BackingPersistence
    | State["EncodingServices"]
  >
}

/**
 * @since 1.0.0
 * @category Initial state
 */
export interface InitialState {
  readonly _: unique symbol
}

/**
 * @since 1.0.0
 * @category Handlers
 */
export interface Handler<Tag extends string> {
  readonly _: unique symbol
  readonly _tag: Tag
}

/**
 * @since 1.0.0
 * @category Initial state
 */
export class SendDiscard extends Context.Service<
  SendDiscard,
  (tag: string, payload: any) => Effect.Effect<void>
>()("@effectfultech/clanka-utils/GenServer/SendDiscard") {}

/**
 * @since 1.0.0
 * @category Handlers
 */
export type ToHandler<Rpc extends Rpc.Any> = Rpc extends Rpc.Any
  ? Handler<Rpc["_tag"]>
  : never

/**
 * @since 1.0.0
 * @category Handlers
 */
export type Handlers<State extends Schema.Top, Rpcs extends Rpc.Any> = {
  [R in Rpcs as R["_tag"]]: HandlerFn<State, R, any>
}

/**
 * @since 1.0.0
 * @category Handlers
 */
export type HandlerFn<
  State extends Schema.Top,
  Rpc extends Rpc.Any,
  R,
> = (options: {
  readonly state: State["Type"]
  readonly changes: Stream.Stream<State["Type"]>
  readonly payload: Rpc.Payload<Rpc>
  readonly context: Context.Context<never>
}) => Rpc.SuccessSchema<Rpc> extends RpcSchema.Stream<infer A, infer E>
  ? Stream.Stream<A["Type"], E["Type"], R>
  : Effect.Effect<
      readonly [state: State["Type"], result: Rpc.Success<Rpc>],
      Rpc.Error<Rpc>,
      R
    >

/**
 * @since 1.0.0
 * @category Handlers
 */
export type HandlerServices<Handlers extends Record<string, any>> =
  keyof Handlers extends infer K
    ? K extends keyof Handlers
      ? ReturnType<Handlers[K]> extends Effect.Effect<
          infer _A,
          infer _E,
          infer _R
        >
        ? _R
        : ReturnType<Handlers[K]> extends Stream.Stream<
              infer _A,
              infer _E,
              infer _R
            >
          ? _R
          : never
      : never
    : never

/**
 * @since 1.0.0
 * @category Constructors
 */
export const make = <
  State extends Schema.Top,
  const Rpcs extends ReadonlyArray<Rpc.Any>,
>(options: {
  readonly state: State
  readonly protocol: Rpcs
}): GenServer<State, Rpcs[number]> =>
  fromRpcGroup({
    state: options.state,
    group: RpcGroup.make(...options.protocol),
  })

/**
 * @since 1.0.0
 * @category Constructors
 */
export const fromRpcGroup = <
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
>(options: {
  readonly state: State
  readonly group: RpcGroup.RpcGroup<Rpcs>
}): GenServer<State, Rpcs> => {
  const self = Object.create(Proto)
  self.stateSchema = options.state
  self.protocol = options.group
  return self
}

const Proto: Omit<GenServer<any, any>, "stateSchema" | "protocol"> = {
  get sender() {
    return SendDiscard.useSync((send) => send as any)
  },
  of(initialState: any, handlers: any) {
    return [initialState, handlers]
  },
  toLayer(
    this: GenServer<any, any>,
    build: Effect.Effect<
      readonly [initialState: any, Handlers<any, any>],
      any,
      any
    >,
  ) {
    // oxlint-disable-next-line typescript/no-this-alias
    const schema = this
    return Layer.fresh(
      Layer.effectContext(
        Effect.gen(function* () {
          const services = yield* Effect.context()
          const [initialState, handlers] = yield* build
          const handlerMap = new Map<string, any>()
          handlerMap.set(initialStateKey, initialState)
          for (const [tag, handler] of Object.entries(handlers)) {
            const rpc = schema.protocol.requests.get(tag)! as Rpc.AnyWithProps
            const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
            handlerMap.set(handlerKey(tag), (options: any) =>
              isStream
                ? Stream.provideContext(handler(options) as any, services)
                : Rpc.wrapMap(
                    handler(options),
                    Effect.provideContext(services),
                  ),
            )
          }
          return Context.makeUnsafe(handlerMap)
        }),
      ),
    )
  },
  toLayerPersisted(
    this: GenServer<any, any>,
    build: (
      load: (
        id: string,
      ) => Effect.Effect<Option.Option<any>, Persistence.PersistenceError, any>,
    ) => Effect.Effect<
      readonly [initialState: any, Handlers<any, any>],
      any,
      any
    >,
    options?: {
      readonly storeId?: string | undefined
    },
  ) {
    // oxlint-disable-next-line typescript/no-this-alias
    const schema = this
    const storeId = options?.storeId ?? "machine"
    const stateFromJson = Schema.toCodecJson(this.stateSchema)
    const decode = Schema.decodeUnknownEffect(stateFromJson)
    const encode = Schema.encodeUnknownEffect(stateFromJson)
    return Layer.fresh(
      Layer.effectContext(
        Effect.gen(function* () {
          const services = yield* Effect.context()
          const persistence = yield* Persistence.BackingPersistence
          const store = yield* persistence.make(storeId)
          let currentId = "default"
          const load = (id: string) =>
            Effect.suspend(() => {
              currentId = id
              return store.get(id)
            }).pipe(
              Effect.flatMap((a) =>
                a ? Effect.asSome(Effect.orDie(decode(a))) : Effect.succeedNone,
              ),
            )
          const [initialState, handlers] = yield* build(load)
          const handlerMap = new Map<string, any>([
            initialStateKey,
            initialState,
          ])
          for (const [tag, handler] of Object.entries(handlers)) {
            const rpc = schema.protocol.requests.get(tag)! as Rpc.AnyWithProps
            const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
            handlerMap.set(handlerKey(tag), (options: any) =>
              isStream
                ? Stream.provideContext(handler(options) as any, services)
                : Rpc.wrapMap(
                    handler(options),
                    flow(
                      Effect.tap(([state]) =>
                        Effect.flatMap(encode(state), (a) =>
                          store.set(currentId, a as any, undefined),
                        ),
                      ),
                      Effect.provideContext(services),
                    ),
                  ),
            )
          }
          return Context.makeUnsafe(handlerMap)
        }),
      ),
    )
  },
}

const initialStateKey = `effect-genserver/GenServer/InitialState`
const handlerKey = (tag: string) => `effect-genserver/GenServer/Handler/${tag}`

/**
 * @since 1.0.0
 * @category Handlers
 */
export const makeHandlers = Effect.fnUntraced(function* <
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
  E,
  R,
>(
  schema: GenServer<State, Rpcs>,
  layer: Layer.Layer<ToHandler<Rpcs> | InitialState, E, R>,
): Effect.fn.Return<
  {
    readonly state: MutableRef.MutableRef<State["Type"]>
    readonly pubsub: PubSub.PubSub<State["Type"]>
    readonly handlers: ReadonlyMap<
      string,
      {
        readonly rpc: Rpc.AnyWithProps
        readonly handler: (options: {
          readonly payload: any
          readonly context: Context.Context<never>
        }) => Stream.Stream<any, any> | Effect.Effect<any, any>
      }
    >
  },
  E,
  Exclude<R, SendDiscard> | Scope.Scope
> {
  const handlers = new Map<
    string,
    {
      readonly rpc: Rpc.AnyWithProps
      readonly handler: (options: {
        readonly payload: any
        readonly context: Context.Context<never>
      }) => Stream.Stream<any, any> | Effect.Effect<any, any>
    }
  >()
  const scope = yield* Effect.scope
  const startLatch = Latch.makeUnsafe(false)
  let started = false
  const sendSemaphore = Semaphore.makeUnsafe(1)
  const stateChanges = RpcStateChanges(schema)

  const sendDiscard = (tag: string, payload: any) => {
    const eff = started
      ? sendDiscardImpl(tag, payload)
      : startLatch.whenOpen(sendDiscardImpl(tag, payload))
    return eff.pipe(Effect.forkIn(scope), Effect.asVoid)
  }
  const sendDiscardImpl = (tag: string, payload: any) =>
    Effect.suspend(() => {
      const entry = handlers.get(tag)
      if (!entry) {
        return Effect.void
      }
      const result = entry.handler({
        payload,
        context: Context.empty(),
      })
      return Stream.isStream(result) ? Stream.runDrain(result) : result
    })

  const services = yield* Layer.build(layer).pipe(
    Effect.provideService(SendDiscard, sendDiscard),
  )
  const state = MutableRef.make(
    services.mapUnsafe.get(initialStateKey) as State["Type"],
  )
  const pubsub = yield* PubSub.unbounded<State["Type"]>({
    replay: 1,
  })
  PubSub.publishUnsafe(pubsub, state.current)
  const changes = Stream.fromPubSub(pubsub)

  handlers.set(stateChanges._tag, {
    rpc: stateChanges,
    handler: (_) => Stream.fromPubSub(pubsub) as any,
  })

  for (const rpc of schema.protocol.requests.values()) {
    const handler = services.mapUnsafe.get(handlerKey(rpc._tag)) as HandlerFn<
      State,
      any,
      never
    >
    handlers.set(rpc._tag, {
      rpc: rpc as any,
      handler: (options) => {
        const result = handler({
          state: state.current,
          changes,
          payload: options.payload,
          context: options.context,
        }) as Stream.Stream<any, any> | Effect.Effect<any, any>
        if (Stream.isStream(result)) return result
        return pipe(
          result,
          Effect.map(([nextState, result]) => {
            if (nextState !== state.current) {
              MutableRef.set(state, nextState)
              PubSub.publishUnsafe(pubsub, nextState)
            }
            return result
          }),
          sendSemaphore.withPermits(1),
        )
      },
    })
  }

  startLatch.openUnsafe()
  started = true

  return { handlers, state, pubsub }
})

/**
 * @since 1.0.0
 * @category RpcServer
 */
export const RpcStateChanges = <State extends Schema.Top, Rpcs extends Rpc.Any>(
  server: GenServer<State, Rpcs>,
): Rpc.Rpc<
  "GenServerChanges",
  Schema.Void,
  RpcSchema.Stream<State, Schema.Never>
> =>
  Rpc.make("GenServerChanges", {
    success: server.stateSchema,
    stream: true,
  })

/**
 * @since 1.0.0
 * @category Actor
 */
export interface Actor<State extends Schema.Top, Rpcs extends Rpc.Any> {
  readonly changes: Stream.Stream<State["Type"]>
  readonly state: MutableRef.MutableRef<State["Type"]>
  send<
    Tag extends Rpcs["_tag"],
    Rpc = Rpc.ExtractTag<Rpcs, Tag>,
    Payload = Rpc.PayloadConstructor<Rpc>,
  >(
    tag: Tag,
    ...args: Types.EqualsWith<
      Payload,
      void,
      [payload?: Payload],
      [payload: Payload]
    >
  ): Rpc.SuccessSchema<Rpc> extends RpcSchema.Stream<infer A, infer E>
    ? Stream.Stream<A["Type"], E["Type"]>
    : Effect.Effect<Rpc.Success<Rpc>, Rpc.Error<Rpc>>
}

/**
 * @since 1.0.0
 * @category Actor
 */
export const makeActor = Effect.fnUntraced(function* <
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
  E,
  R,
>(
  schema: GenServer<State, Rpcs>,
  layer: Layer.Layer<ToHandler<Rpcs> | InitialState, E, R>,
  options?: {
    readonly requestContext?: Context.Context<never> | undefined
  },
): Effect.fn.Return<
  Actor<State, Rpcs>,
  E,
  Exclude<R, SendDiscard> | Scope.Scope
> {
  const requestContext = options?.requestContext ?? Context.empty()

  const { handlers, state, pubsub } = yield* makeHandlers(schema, layer)

  const send = <Tag extends Rpcs["_tag"], Rpc = Rpc.ExtractTag<Rpcs, Tag>>(
    tag: Tag,
    payload_?: Rpc.PayloadConstructor<Rpc>,
  ) => {
    const entry = handlers.get(tag)
    if (!entry) {
      const rpc = schema.protocol.requests.get(tag)! as any as Rpc.AnyWithProps
      const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
      const message = `Unknown tag: ${tag}`
      return isStream ? Stream.die(message) : Effect.die(message)
    }
    return entry.handler({
      payload:
        payload_ !== undefined
          ? entry.rpc.payloadSchema.make(payload_)
          : undefined,
      context: requestContext,
    })
  }

  return identity<Actor<State, Rpcs>>({
    changes: Stream.fromPubSub(pubsub),
    state,
    send: send as any,
  })
})
