/**
 * @since 1.0.0
 */
import type * as Rpc from "effect/unstable/rpc/Rpc"
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
    readonly idleTTL?: Duration.Input | undefined
    readonly initialState?: InitialState | undefined
  },
): {
  readonly actor: Atom.Atom<
    AsyncResult.AsyncResult<GenServer.Actor<State, Rpcs>, E>
  >
  readonly send: <Tag extends Rpcs["_tag"]>(
    tag: Tag,
    options?: {
      readonly concurrent?: boolean | undefined
    },
  ) => Atom.AtomResultFn<
    Rpc.PayloadConstructor<Rpc.ExtractTag<Rpcs, Tag>>,
    Rpc.Success<Rpc.ExtractTag<Rpcs, Tag>>,
    E | Schema.Schema.Type<Rpc.ErrorSchema<Rpc.ExtractTag<Rpcs, Tag>>>
  >
  readonly state: Atom.Atom<
    [InitialState] extends [undefined]
      ? AsyncResult.AsyncResult<State["Type"], E>
      : State["Type"]
  >
} => {
  const memoMap = options?.memoMap ?? Atom.runtime.memoMap

  const actor = Atom.make((get) => {
    const layer_ = typeof layer === "function" ? layer(get) : layer
    return GenServer.makeActor(server, layer_).pipe(
      Effect.provideService(Layer.CurrentMemoMap, memoMap),
    )
  }).pipe(Atom.setIdleTTL(options?.idleTTL ?? Duration.zero))

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

  const sendFamily = <
    Tag extends Rpcs["_tag"],
    Rpc = Rpc.ExtractTag<Rpcs, Tag>,
  >([tag, concurrent]: [Tag, boolean]): Atom.AtomResultFn<
    Rpc.PayloadConstructor<Rpc>,
    Rpc.Success<Rpc>,
    Rpc.Error<Rpc> | E
  > => {
    return Atom.fn(
      (payload, get) =>
        pipe(
          get.result(actor),
          Effect.flatMap((actor) => actor.send(tag, payload)),
        ),
      { concurrent },
    )
  }

  const send = <Tag extends Rpcs["_tag"]>(
    tag: Tag,
    options?: {
      readonly concurrent?: boolean | undefined
    },
  ) => sendFamily([tag, options?.concurrent ?? false])

  return { actor, send, state }
}
