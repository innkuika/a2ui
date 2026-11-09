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

import 'dart:math' as math;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../../nothing.dart';

/// How one child of a [BasicFlex] takes space.
class BasicFlexParentData extends ContainerBoxParentData<RenderBox> {
  /// The flex factor of the child's `weight`; 0 for none.
  int weight = 0;

  /// Whether the child keeps its own width in an unweighted horizontal flex,
  /// up to an equal share.
  bool ownWidth = false;
}

/// Gives the child of a [BasicFlex] its [weight] and [ownWidth].
class BasicFlexItem extends ParentDataWidget<BasicFlexParentData> {
  const BasicFlexItem({
    super.key,
    required this.weight,
    required this.ownWidth,
    required super.child,
  });

  final int weight;
  final bool ownWidth;

  @override
  void applyParentData(RenderObject renderObject) {
    final data = renderObject.parentData! as BasicFlexParentData;
    if (data.weight != weight || data.ownWidth != ownWidth) {
      data
        ..weight = weight
        ..ownWidth = ownWidth;
      renderObject.parent?.markNeedsLayout();
    }
  }

  @override
  Type get debugTypicalAncestorWidgetClass => BasicFlex;
}

/// The basic Row, Column and List layout: a flex in which children that
/// render nothing ([RenderA2uiNothing.collapses]) take no part at all.
///
/// Among the other children: the [spacing] goes between them, [justify]
/// distributes the free space, and on a bounded main axis weighted children
/// share it by weight. In a horizontal flex with no weighted child, children
/// keep their own width ([BasicFlexParentData.ownWidth]) up to an equal share,
/// or share the rest equally. [align] stretches only on a bounded cross axis.
class BasicFlex extends MultiChildRenderObjectWidget {
  const BasicFlex({
    super.key,
    required this.direction,
    required this.justify,
    required this.align,
    required this.spacing,
    super.children,
  });

  final Axis direction;
  final MainAxisAlignment justify;
  final CrossAxisAlignment align;
  final double spacing;

  @override
  RenderBasicFlex createRenderObject(BuildContext context) => RenderBasicFlex(
    direction: direction,
    justify: justify,
    align: align,
    spacing: spacing,
    textDirection: Directionality.maybeOf(context) ?? TextDirection.ltr,
  );

  @override
  void updateRenderObject(BuildContext context, RenderBasicFlex renderObject) {
    renderObject
      ..direction = direction
      ..justify = justify
      ..align = align
      ..spacing = spacing
      ..textDirection = Directionality.maybeOf(context) ?? TextDirection.ltr;
  }
}

/// The sizes [RenderBasicFlex] lays its children out at.
typedef _Layout = ({Size size, double content, Map<RenderBox, Size> sizes});

class RenderBasicFlex extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, BasicFlexParentData>,
        RenderBoxContainerDefaultsMixin<RenderBox, BasicFlexParentData>,
        DebugOverflowIndicatorMixin {
  RenderBasicFlex({
    required Axis direction,
    required MainAxisAlignment justify,
    required CrossAxisAlignment align,
    required double spacing,
    required TextDirection textDirection,
  }) : _direction = direction,
       _justify = justify,
       _align = align,
       _spacing = spacing,
       _textDirection = textDirection;

  Axis get direction => _direction;
  Axis _direction;
  set direction(Axis value) {
    if (_direction == value) return;
    _direction = value;
    markNeedsLayout();
  }

  MainAxisAlignment get justify => _justify;
  MainAxisAlignment _justify;
  set justify(MainAxisAlignment value) {
    if (_justify == value) return;
    _justify = value;
    markNeedsLayout();
  }

  CrossAxisAlignment get align => _align;
  CrossAxisAlignment _align;
  set align(CrossAxisAlignment value) {
    if (_align == value) return;
    _align = value;
    markNeedsLayout();
  }

  double get spacing => _spacing;
  double _spacing;
  set spacing(double value) {
    if (_spacing == value) return;
    _spacing = value;
    markNeedsLayout();
  }

  TextDirection get textDirection => _textDirection;
  TextDirection _textDirection;
  set textDirection(TextDirection value) {
    if (_textDirection == value) return;
    _textDirection = value;
    markNeedsLayout();
  }

  double _overflow = 0;

  bool get _horizontal => _direction == Axis.horizontal;
  double _main(Size size) => _horizontal ? size.width : size.height;
  double _cross(Size size) => _horizontal ? size.height : size.width;
  Size _size(double main, double cross) =>
      _horizontal ? Size(main, cross) : Size(cross, main);

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! BasicFlexParentData) {
      child.parentData = BasicFlexParentData();
    }
  }

  /// The children that render something, in order.
  List<RenderBox> get _shown => [
    for (
      RenderBox? child = firstChild;
      child != null;
      child = childAfter(child)
    )
      if (!RenderA2uiNothing.collapses(child)) child,
  ];

  double _gaps(int count) => count > 1 ? _spacing * (count - 1) : 0;

  _Layout _compute(BoxConstraints constraints, ChildLayouter layoutChild) {
    final List<RenderBox> shown = _shown;
    final double maxMain = _horizontal
        ? constraints.maxWidth
        : constraints.maxHeight;
    final double maxCross = _horizontal
        ? constraints.maxHeight
        : constraints.maxWidth;
    final bool mainBounded = maxMain.isFinite;
    final bool stretch =
        _align == CrossAxisAlignment.stretch && maxCross.isFinite;
    final double gaps = _gaps(shown.length);
    final bool weighted = shown.any((child) => _data(child).weight > 0);
    int factorOf(BasicFlexParentData data) => !mainBounded
        ? 0
        : _horizontal && !weighted
        ? (data.ownWidth ? 0 : 1)
        : data.weight;
    final double share = _horizontal && mainBounded
        ? math.max(0, maxMain - gaps) / shown.length
        : double.infinity;
    BoxConstraints along(double minMain, double maxMainExtent) {
      final double minCross = stretch ? maxCross : 0;
      return _horizontal
          ? BoxConstraints(
              minWidth: minMain,
              maxWidth: maxMainExtent,
              minHeight: minCross,
              maxHeight: maxCross,
            )
          : BoxConstraints(
              minHeight: minMain,
              maxHeight: maxMainExtent,
              minWidth: minCross,
              maxWidth: maxCross,
            );
    }

    final sizes = <RenderBox, Size>{};
    var allocated = 0.0;
    var totalFlex = 0;
    for (final child in shown) {
      final int factor = factorOf(_data(child));
      if (factor > 0) {
        totalFlex += factor;
        continue;
      }
      final Size size = layoutChild(
        child,
        along(0, _horizontal ? share : double.infinity),
      );
      sizes[child] = size;
      allocated += _main(size);
    }
    if (totalFlex > 0) {
      final double perFlex =
          math.max(0, maxMain - allocated - gaps) / totalFlex;
      for (final child in shown) {
        final BasicFlexParentData data = _data(child);
        final int factor = factorOf(data);
        if (factor == 0) continue;
        final double extent = perFlex * factor;
        final Size size = layoutChild(
          child,
          along(data.weight > 0 ? extent : 0, extent),
        );
        sizes[child] = size;
        allocated += _main(size);
      }
    }
    final double content = allocated + gaps;
    final double cross = stretch
        ? maxCross
        : sizes.values.map(_cross).fold(0.0, math.max);
    final main = mainBounded && _justify != MainAxisAlignment.start
        ? maxMain
        : content;
    return (
      size: constraints.constrain(_size(main, cross)),
      content: content,
      sizes: sizes,
    );
  }

  BasicFlexParentData _data(RenderBox child) =>
      child.parentData! as BasicFlexParentData;

  @override
  Size computeDryLayout(BoxConstraints constraints) =>
      _compute(constraints, ChildLayoutHelper.dryLayoutChild).size;

  @override
  void performLayout() {
    for (
      RenderBox? child = firstChild;
      child != null;
      child = childAfter(child)
    ) {
      if (RenderA2uiNothing.collapses(child)) {
        child.layout(BoxConstraints.tight(Size.zero));
        _data(child).offset = Offset.zero;
      }
    }
    final _Layout layout = _compute(constraints, ChildLayoutHelper.layoutChild);
    size = layout.size;
    // In child order: flexible children were laid out after the others.
    final List<RenderBox> shown = _shown;
    final double main = _main(size);
    final double cross = _cross(size);
    final double remaining = math.max(0, main - layout.content);
    _overflow = math.max(0, layout.content - main);
    final int count = shown.length;
    final (double leading, double between) = switch (_justify) {
      MainAxisAlignment.start => (0.0, 0.0),
      MainAxisAlignment.end => (remaining, 0.0),
      MainAxisAlignment.center => (remaining / 2, 0.0),
      MainAxisAlignment.spaceBetween => (
        0.0,
        count > 1 ? remaining / (count - 1) : 0.0,
      ),
      MainAxisAlignment.spaceAround =>
        count == 0 ? (0.0, 0.0) : (remaining / count / 2, remaining / count),
      MainAxisAlignment.spaceEvenly => (
        remaining / (count + 1),
        remaining / (count + 1),
      ),
    };
    final bool flipMain = _horizontal && _textDirection == TextDirection.rtl;
    final bool flipCross = !_horizontal && _textDirection == TextDirection.rtl;
    var position = leading;
    for (final child in shown) {
      final Size childSize = child.size;
      final double free = cross - _cross(childSize);
      final double crossOffset = switch (_align) {
        CrossAxisAlignment.center => free / 2,
        CrossAxisAlignment.end => flipCross ? 0 : free,
        CrossAxisAlignment.start => flipCross ? free : 0,
        _ => 0,
      };
      final double mainOffset = flipMain
          ? main - position - _main(childSize)
          : position;
      _data(child).offset = _horizontal
          ? Offset(mainOffset, crossOffset)
          : Offset(crossOffset, mainOffset);
      position += _main(childSize) + _spacing + between;
    }
  }

  // Intrinsics are approximate: each child gets an equal share of a given
  // main-axis extent.
  double _mainIntrinsic(double cross, bool max) {
    final List<RenderBox> shown = _shown;
    double sum = _gaps(shown.length);
    for (final child in shown) {
      sum += switch ((_horizontal, max)) {
        (true, true) => child.getMaxIntrinsicWidth(cross),
        (true, false) => child.getMinIntrinsicWidth(cross),
        (false, true) => child.getMaxIntrinsicHeight(cross),
        (false, false) => child.getMinIntrinsicHeight(cross),
      };
    }
    return sum;
  }

  double _crossIntrinsic(double main, bool max) {
    final List<RenderBox> shown = _shown;
    final double extent = main.isFinite
        ? math.max(0, main - _gaps(shown.length)) / shown.length
        : double.infinity;
    var result = 0.0;
    for (final child in shown) {
      result = math.max(result, switch ((_horizontal, max)) {
        (true, true) => child.getMaxIntrinsicHeight(extent),
        (true, false) => child.getMinIntrinsicHeight(extent),
        (false, true) => child.getMaxIntrinsicWidth(extent),
        (false, false) => child.getMinIntrinsicWidth(extent),
      });
    }
    return result;
  }

  @override
  double computeMinIntrinsicWidth(double height) => _horizontal
      ? _mainIntrinsic(height, false)
      : _crossIntrinsic(height, false);

  @override
  double computeMaxIntrinsicWidth(double height) => _horizontal
      ? _mainIntrinsic(height, true)
      : _crossIntrinsic(height, true);

  @override
  double computeMinIntrinsicHeight(double width) => _horizontal
      ? _crossIntrinsic(width, false)
      : _mainIntrinsic(width, false);

  @override
  double computeMaxIntrinsicHeight(double width) =>
      _horizontal ? _crossIntrinsic(width, true) : _mainIntrinsic(width, true);

  @override
  double? computeDistanceToActualBaseline(TextBaseline baseline) => _horizontal
      ? defaultComputeDistanceToHighestActualBaseline(baseline)
      : defaultComputeDistanceToFirstActualBaseline(baseline);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);

  @override
  void paint(PaintingContext context, Offset offset) {
    defaultPaint(context, offset);
    assert(() {
      if (_overflow > 0) {
        paintOverflowIndicator(
          context,
          offset,
          Offset.zero & size,
          Offset.zero & _size(_main(size) + _overflow, _cross(size)),
        );
      }
      return true;
    }());
  }
}
