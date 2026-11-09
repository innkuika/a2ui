# Collapsing flex prototype (Flutter): "nothing" decided at layout time

Prototype for direction B in the #3997 review: containers lay out **every** child, and a child that renders
nothing collapses at layout time. It has no size, no gap, no flex share and no part in `justify`.
Local branch `proto/collapsing-flex` (on top of `feat/fallbacks-flutter`), commit `b9c33aa9`. Not for merge.

## TL;DR
- **It works, and it isn't heavy.** About 500 lines of library code: a ~80-line marker widget and a ~400-line
  render object, about half of it setters, intrinsics and paint boilerplate. `buildChildOrNull` is gone.
- **All 436 tests pass.** That includes the #3714 "unresolved children" layout tests, the fallback layout
  tests from #3997, all example payloads and the AlertDialog (intrinsics) test. One existing test only
  needed a type rename: it inspected `Flex`, and now inspects `BasicFlex`.
- **Rendering is pixel-identical.** The 6 #3997 screenshot cases match the current PR branch exactly.
- **All four Flutter deviations go away.** There's no helper, so no odd signature. Builders run once.
  A delayed fallback takes a slot only when it appears. The catalog imports only the public `A2uiNothing`,
  with no fallback or NodeView internals.

## How it works

### 1. An explicit marker, not a size check
Measuring doesn't work: an expanding empty child also has zero intrinsic size. `NodeView` renders
`A2uiNothing` when a node shows nothing (unresolved with no fallback, or a builder that returned null):

```dart
class A2uiNothing extends LeafRenderObjectWidget {          // public, exported
  const A2uiNothing({super.key});
  @override
  RenderA2uiNothing createRenderObject(BuildContext context) => RenderA2uiNothing();
}

class RenderA2uiNothing extends RenderBox {
  /// A child collapses if it is this, or proxy boxes down to this.
  static bool collapses(RenderBox child) {
    RenderObject? node = child;
    while (node is RenderProxyBox) node = node.child;      // Semantics, ConstrainedBox, Opacity...
    return node is RenderA2uiNothing;
  }
  @override bool get sizedByParent => true;
  @override Size computeDryLayout(BoxConstraints c) => c.smallest;
  // + attach/detach notify the container (see "Gotchas")
}
```

The container walks down from each child's render object through `RenderProxyBox`es. Those take their
child's size, so they collapse with it. `KeyedSubtree`, `Flexible`-style parent-data widgets and
stateless/stateful widgets have no render object, so they're transparent for free. Anything else, such as
`Padding` or a `Card`, counts as "something".

### 2. A flex that ignores collapsed children
`BasicFlex` / `RenderBasicFlex` replace `Flex` + `LayoutBuilder` in the basic Row, Column and List. The
per-child `weight` and `ownWidth` move from build time into `ParentData` (`BasicFlexItem`). The rules that
depended on the number of shown children now run at layout time, over the children that don't collapse:
- the equal share;
- whether any child is weighted;
- unweighted children flexing at 1 versus keeping their own width up to an equal share.

```dart
// _FlexContainer.build: no prediction, every child gets buildChild
return BasicFlex(direction: ..., justify: ..., align: ..., spacing: flexGap, children: [
  for (var i = 0; i < children.length; i++)
    KeyedSubtree(
      key: NodeKey(children[i].instanceId),
      child: BasicFlexItem(weight: slots[i].$1, ownWidth: slots[i].$2,
                           child: widget.buildChild(children[i])),
    ),
]);
```

```dart
// RenderBasicFlex._compute (shared by performLayout and computeDryLayout)
final shown = [for (child in children) if (!RenderA2uiNothing.collapses(child)) child];
final gaps = spacing * (shown.length - 1);
final weighted = shown.any((c) => data(c).weight > 0);
final share = horizontal && mainBounded ? (maxMain - gaps) / shown.length : double.infinity;
// inflexible children first (capped at share), then flexible ones split the free space by factor,
// tight for weights, loose otherwise. Then justify distributes `remaining` over shown.length.
// Collapsed children are laid out at tight zero, at offset zero.
```

The algorithm is RenderFlex's, cut down to what the basic catalog uses. It doesn't support baseline
alignment, `verticalDirection` or `clipBehavior`. It does handle RTL, and it paints the debug overflow
indicator through `DebugOverflowIndicatorMixin`.

### 3. Delayed fallbacks work with nothing predicted
```dart
pending: (context, info) => Delayed(              // app code, renders A2uiNothing until the timer fires
  delay: const Duration(milliseconds: 300),
  child: const SkeletonRow(),
),
```
The test checks that B sits right after A with one gap, and that after 300 ms the skeleton sits between them
with gaps. It also passes when the fallback wraps the delayed widget in `Semantics` + `ConstrainedBox`.

A resolved custom component can collapse too, by returning `A2uiNothing` from its builder.
`NodeView`'s `Semantics` wrappers are proxies, so they collapse with it. This is tested with a weighted
component toggled by data: siblings take its share, then give it back.

## Tests (all in the existing suites)
- Ported unchanged and passing:
  - `layout_test` "unresolved children" (#3714 behavior without fallbacks): no gap, no width share, no part
    in justify, takes its place on arrival.
  - "children with a fallback" (#3997): slot with gaps in Column and List, replaced in place, null builder
    takes no slot, Row weights unaffected, takes part in justify.
  - `v1_0_test`, `fallbacks_test`, `examples_test`, `imports_test`.
- New:
  - a delayed fallback appears and takes a slot, plain and under proxy boxes;
  - a removed child collapses again;
  - a weighted component that renders `A2uiNothing` collapses and comes back;
  - a fallback builder runs once per build (it ran twice with `buildChildOrNull`).
- Removed: the `buildChildOrNull` tests.
- Both container notifications are exercised. Disabling the attach notification fails the
  weighted-component test, and disabling the detach notification fails the proxy-box delayed test.

## Cost of a real PR
- About 500 lines of library code as prototyped, plus about 100 to finish: exact flex intrinsics, dry
  baseline, docs.
- About 250 lines of tests.
- `layout.dart` gets about 60 lines smaller, and `buildChildOrNull` with its docs is deleted.
- A §4.4 rule 5 / §6 blueprint edit: "nothing" becomes a layout-time property, and Flutter containers use a
  collapsing layout.

## Gotchas and open points
1. **Relayout boundaries.** Collapsed children are laid out at tight zero, which makes the proxy boxes above
   the marker relayout boundaries. Swapping the marker for real content then wouldn't reach the container.
   Likewise, a tight-constrained weighted child going to nothing wouldn't either. `RenderA2uiNothing`
   therefore marks its host (the first non-proxy ancestor) as needing layout on `attach` and `detach`.
   This is about 15 lines, and both paths have a test. During its own `performLayout`, a host already has
   `_needsLayout == true`, so these calls are no-ops and don't assert.
2. **Intrinsics are approximate.** Cross-axis intrinsics give each shown child an equal share of the
   main-axis extent. RenderFlex distributes the extent by flex factor. This is enough for AlertDialog and
   IntrinsicHeight, but a real PR should port RenderFlex's computation (about 60 lines).
3. **Baselines.** Actual baselines are implemented: highest for a Row, first for a Column, and collapsed
   children have none. `computeDryBaseline` isn't implemented yet, so a dry baseline query would assert
   (about 20 lines to add).
4. **Semantics.** A collapsed child has no semantics of its own. A fallback that wraps `A2uiNothing` in
   `Semantics(label: ...)` keeps a zero-size semantics node; I haven't checked whether TalkBack or
   VoiceOver skip it. Advice: don't label nothing.
5. **"Proxy" is a heuristic.** `ConstrainedBox(minWidth: 40, child: A2uiNothing())` still collapses,
   because nothing wins over constraints. `Padding` around it doesn't collapse.
6. **Custom containers.** An app container built on Flutter's own `Row`/`Column` still gives a zero-size
   `A2uiNothing` its `spacing` gap. That's no worse than today's `SizedBox.shrink()`, and better than a
   helper they must remember to call. To give them collapse too, a real PR should export a generic
   `A2uiFlex` with a Flex-like API (`direction`, `mainAxisAlignment`, `crossAxisAlignment`, `spacing`,
   `A2uiFlexible`). The basic catalog's `ownWidth` / equal-share rules would stay in its parent data.
   Grid-like custom containers would collapse a cell's chrome only if they check `RenderA2uiNothing.collapses`.
7. **Performance.**
   - Per layout, each child costs one walk down its proxy chain, a few levels.
   - The container relayouts once when a marker attaches or detaches.
   - `LayoutBuilder` is gone. It used to rebuild the children's widgets whenever the constraints changed.
   - Builders run once instead of twice.
   - I didn't benchmark, but nothing here is worse than `Flex`.

## Recommendation
**B is feasible in Flutter at moderate cost.** It's one self-contained render object that only the basic
catalog's three containers use, plus a marker widget. It removes the Flutter deviations at the root, not by
patching them, and it handles delayed fallbacks and components that render nothing for free. I'd go with
B and the generic `A2uiFlex` export (point 6), finish intrinsics and dry baseline (points 2–3), and rewrite
§4.4 rule 5 / §6 around "a child that renders nothing collapses at layout time; frameworks without such
layout use a collapsing container". A remains the quick fallback if reviewers don't want a custom render
object in the adapter.
