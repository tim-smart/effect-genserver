/**
 * @since 1.0.0
 */
import type * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcSchema from "effect/unstable/rpc/RpcSchema"
import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import * as GenServer from "./GenServer.ts"
import * as Atom from "effect/unstable/reactivity/Atom"
import { identity, pipe } from "effect/Function"
import * as Stream from "effect/Stream"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Duration from "effect/Duration"

/**
 * @since 1.0.0
 * @category Atom
 */
export interface GenServerAtom<
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
  E,
  InitialState extends boolean,
  // oxlint-disable-next-line import/namespace
> extends Atom.Writable<
  [InitialState] extends [true]
    ? State["Type"]
    : AsyncResult.AsyncResult<State["Type"], E>,
  Rpcs extends Rpc.Rpc<
    infer _Tag,
    infer _Payload,
    infer _Success,
    infer _Error,
    infer _Middleware,
    infer _Requires
  >
    ? {
        readonly _tag: _Tag
        readonly payload: _Payload["~type.make.in"]
      }
    : never
> {
  /**
   * Atom that contains the actor.
   */
  readonly actor: Atom.Atom<
    AsyncResult.AsyncResult<GenServer.Actor<State, Rpcs>, E>
  >

  /**
   * Use .fn when you need to subscribe to the result of an event.
   */
  fn<Tag extends Rpcs["_tag"], Rpc = Rpc.ExtractTag<Rpcs, Tag>>(
    tag: Tag,
    options?: {
      readonly concurrent?: boolean | undefined
    },
  ): Atom.AtomResultFn<
    Rpc.PayloadConstructor<Rpc>,
    Rpc.SuccessExit<Rpc>,
    E | Rpc.ErrorExit<Rpc>
  >
}

/**
 * @since 1.0.0
 * @category Atom
 */
export const make = <
  State extends Schema.Top,
  Rpcs extends Rpc.Any,
  E,
  InitialState extends State["Type"] | undefined = undefined,
>(
  server: GenServer.GenServer<State, Rpcs>,
  layer:
    | Layer.Layer<
        GenServer.ToHandler<Rpcs> | GenServer.InitialState,
        E,
        GenServer.SendDiscard
      >
    | ((
        get: Atom.AtomContext,
      ) => Layer.Layer<
        GenServer.ToHandler<Rpcs> | GenServer.InitialState,
        E,
        GenServer.SendDiscard
      >),
  options?: {
    readonly memoMap?: Layer.MemoMap | undefined
    readonly actorIdleTTL?: Duration.Input | undefined
    readonly initialState?: InitialState
  },
): GenServerAtom<
  State,
  Rpcs,
  E,
  [InitialState] extends [undefined] ? never : true
> => {
  const memoMap = options?.memoMap ?? Atom.runtime.memoMap

  const actor = Atom.make((get) => {
    const layer_ = typeof layer === "function" ? layer(get) : layer
    return GenServer.makeActor(server, layer_).pipe(
      Effect.provideService(Layer.CurrentMemoMap, memoMap),
    )
  }).pipe(Atom.setIdleTTL(options?.actorIdleTTL ?? Duration.zero))

  const state = pipe(
    Atom.make((get) =>
      pipe(
        get.result(actor),
        Effect.map((actor) => actor.changes),
        Stream.unwrap,
      ),
    ),
    options?.initialState
      ? Atom.map(AsyncResult.getOrElse(() => options.initialState))
      : identity,
  ) as Atom.Atom<AsyncResult.AsyncResult<State["Type"], E>>

  const sendDiscard = Atom.fn<{
    readonly tag: Rpcs["_tag"]
    readonly payload: any
  }>()(
    ({ tag, payload }, get) =>
      pipe(
        get.result(actor),
        Effect.flatMap((actor) => actor.sendDiscard(tag, payload)),
      ),
    { concurrent: true },
  )

  const sendFamily = <
    Tag extends Rpcs["_tag"],
    Rpc = Rpc.ExtractTag<Rpcs, Tag>,
  >([tag, concurrent]: [Tag, boolean]): Atom.AtomResultFn<
    Rpc.PayloadConstructor<Rpc>,
    Rpc.SuccessExit<Rpc>,
    Rpc.ErrorExit<Rpc> | E
  > => {
    const rpc = server.protocol.requests.get(tag)! as any as Rpc.AnyWithProps
    const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
    if (isStream) {
      return Atom.fn((payload, get) =>
        pipe(
          get.result(actor),
          Effect.map(
            (actor) => actor.send(tag, payload) as Stream.Stream<any, any>,
          ),
          Stream.unwrap,
        ),
      )
    }
    return Atom.fn(
      (payload, get) =>
        pipe(
          get.result(actor),
          Effect.flatMap(
            (actor) => actor.send(tag, payload) as Effect.Effect<any, any>,
          ),
        ),
      { concurrent },
    )
  }

  const send = <Tag extends Rpcs["_tag"], Rpc = Rpc.ExtractTag<Rpcs, Tag>>(
    tag: Tag,
    options?: {
      readonly concurrent?: boolean | undefined
    },
  ): Atom.AtomResultFn<
    Rpc.PayloadConstructor<Rpc>,
    Rpc.SuccessExit<Rpc>,
    E | Rpc.ErrorExit<Rpc>
  > => sendFamily([tag, options?.concurrent ?? false])

  return Object.assign(
    Atom.writable(
      (get) => {
        get.mount(sendDiscard)
        get.subscribe(state, (next) => get.setSelf(next))
        return get.once(state)
      },
      (ctx, payload: any) => ctx.set(sendDiscard, payload),
    ),
    {
      actor,
      fn: send,
    },
  )
}
