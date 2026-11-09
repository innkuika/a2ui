// Copyright 2024 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Renders nothing, and tells a collapsing container to leave this child
/// out of its layout: no size, no gap, no flex share, no part in `justify`.
///
/// `NodeView` renders it for a node that shows nothing. A fallback that
/// should show nothing for now, such as one that appears after a delay, can
/// render it too: when it renders something else, the container lays it out
/// again and gives it a slot.
class A2uiNothing extends LeafRenderObjectWidget {
  const A2uiNothing({super.key});

  @override
  RenderA2uiNothing createRenderObject(BuildContext context) =>
      RenderA2uiNothing();
}

/// The render object of [A2uiNothing]: the smallest size its constraints
/// allow, no paint and no hit.
class RenderA2uiNothing extends RenderBox {
  /// The nearest ancestor above the proxy boxes over this, which decides
  /// whether to collapse the child holding this.
  RenderObject? _host;

  /// Whether [child] renders nothing: it is a [RenderA2uiNothing], or proxy
  /// boxes down to one. Proxy boxes (semantics, constrained box, opacity...)
  /// take their child's size, so they collapse with it.
  static bool collapses(RenderBox child) {
    RenderObject? node = child;
    while (node is RenderProxyBox) {
      node = node.child;
    }
    return node is RenderA2uiNothing;
  }

  // A collapsed child gets tight zero constraints, which makes the proxy boxes
  // above this relayout boundaries, so replacing this would not reach the
  // container: tell it directly.
  @override
  void attach(PipelineOwner owner) {
    super.attach(owner);
    RenderObject? host = parent;
    while (host is RenderProxyBox) {
      host = host.parent;
    }
    _host = host?..markNeedsLayout();
  }

  @override
  void detach() {
    final RenderObject? host = _host;
    _host = null;
    if (host != null && host.attached) host.markNeedsLayout();
    super.detach();
  }

  @override
  bool get sizedByParent => true;

  @override
  Size computeDryLayout(BoxConstraints constraints) => constraints.smallest;

  @override
  bool hitTestSelf(Offset position) => false;
}
