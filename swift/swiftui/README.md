# A2UI SwiftUI framework adapter (`A2UISwiftUI`)

The `A2UISwiftUI` package provides the native SwiftUI rendering layer for A2UI, mapping
`SurfaceViewModel` trees into declarative Apple views on iOS and iPadOS 17+ and macOS 14+.

For the platform-agnostic rendering and layout specifications, see the
[framework adapter blueprint][adapter-bp] and the [basic catalog guide][catalog-guide].

[adapter-bp]: ../../blueprints/modules/a2ui_framework_adapter.blueprint.md
[catalog-guide]: ../../specification/v0_9_1/docs/basic_catalog_implementation_guide.md

---

## 1. Targets and responsibilities

Defined in root [Package.swift](../../Package.swift):

- **`A2UISwiftUI`** (`Sources/A2UISwiftUI/`):
  Core rendering engine. Provides the root `Surface` view, recursive `ComponentNodeView`,
  reactive data-binding adapters, and SwiftUI environment keys (`a2uiCatalogs`, `a2uiTheme`).
- **`BasicCatalogSwiftUI`** (`Sources/BasicCatalog/`):
  Concrete native SwiftUI views for all Basic Catalog components (`A2UIText`, `A2UIButton`,
  `A2UIRow`, `A2UIColumn`, `A2UICard`, `A2UIList`, `A2UITabs`, `A2UIModal`, etc.) conforming to
  `ComponentImplementation`.

---

## 2. Usage example

```swift
import A2UICore
import A2UISwiftUI
import BasicCatalogSwiftUI
import SwiftUI

struct ChatView: View {
  @ObservedObject var surfaceViewModel: SurfaceViewModel

  var body: some View {
    VStack {
      // Embed native A2UI Surface with registered SwiftUI catalogs
      Surface(
        viewModel: surfaceViewModel,
        catalogs: BasicCatalogImplementation.allCatalogs
      )
    }
  }
}
```

### Fallbacks for components that can't render

By default a component that hasn't arrived yet, or can't render (its type is in no catalog, or
it repeats one of its ancestors), renders nothing. Pass `fallbacks` to show your own view
instead (see the [framework adapter blueprint][adapter-bp] §4.4):

```swift
Surface(
  viewModel: surfaceViewModel,
  catalogs: BasicCatalogImplementation.allCatalogs,
  fallbacks: A2UIFallbacks(
    pending: { info in
      // `info.parentComponentType` is nil for the root, which is pending until it arrives.
      info.parentComponentType == "List" ? AnyView(SkeletonRow()) : AnyView(ProgressView())
    },
    error: { info in
      AnyView(Text("Can't show \(info.error.componentType ?? info.error.type)"))
    }
  )
)
```

A builder that returns `nil` renders nothing, which takes no space. A fallback replaces the
component in place once it arrives.

---

## 3. Creating custom SwiftUI components

To render custom component types in SwiftUI:

1. Construct a `ComponentImplementation` combining a `ComponentAPI` and view builder:

```swift
import A2UICore
import A2UISwiftUI
import SwiftUI

let customProfileImplementation = ComponentImplementation(api: UserCardAPI()) { node in
  VStack {
    Text(node.string(for: "name") ?? "Unknown")
      .font(.headline)
  }
}
```

2. Register the `ComponentImplementation` in a `Catalog<ComponentImplementation>` and pass it to `Surface(viewModel:catalogs:)`.

Render children with `ComponentNodeView(node:)`: it renders the surface's fallback for a child
that can't render. A child that hasn't arrived is a placeholder node (`node.state == .pending`)
in `node.child(for:)` and `node.children(for:)`. A container that gives each child its own slot
(spacing, a `Spacer`, a frame) should lay out `node.renderedChildren(for:in:defaultCatalogID:fallbacks:)`,
which leaves out the children that render nothing, as the basic catalog's `Row` and `Column` do.

### Accessibility

`ComponentNodeView` applies each component's A2UI `accessibility` attributes to the rendered view,
so custom components get them without extra work:

- `label`: `accessibilityLabel`
- `description`: `accessibilityHint`
- `hidden`: `accessibilityHidden` for the whole subtree
- `live` (`polite` / `assertive`) announces the explicit `label` whenever it changes, for
  example when it is bound to the data model

Only values the agent sets are applied, so SwiftUI keeps inferring labels from visible text.

SwiftUI applies a label set on a stack to every element inside it. If your component's root is a
stack:

- with one focusable control (like a text field with a title and an error line), call
  `.a2uiAccessibilityControl(for: node, defaultLabel: title)` on the control, so the label and
  hint reach the element that VoiceOver focuses, and hide the visible title with
  `.accessibilityHidden(true)` so the field is not read twice;
- otherwise, call `.a2uiAccessibilityElement(for: node, children: .contain)` on the root (or
  `.combine` for read-only content), so the label describes the component as a whole. The basic
  catalog's `Row`, `Column`, `List` and `Card` do this.

The basic catalog's selectable controls expose their state to assistive technologies without
custom strings: `CheckBox` and `multipleSelection` `ChoicePicker` options are represented as a
standard `Toggle` (`accessibilityRepresentation`), so the platform announces their on/off state
in the user's language, while `mutuallyExclusive` options and the selected `Tabs` header carry
the selected trait. On iOS 17 and macOS 14 and later, the row of tab headers also carries the tab
bar trait.

Limitations: SwiftUI drops an accessibility hint on a group, so `description` has no effect on
layout containers or other `.contain` groups (for example `ChoicePicker`). Announcing changes to
a live component's visible text, rather than its label, is tracked in
[#3147](https://github.com/a2ui-project/a2ui/issues/3147).

---

## 4. Development and testing

To run SwiftUI adapter unit tests:

```bash
# Run SwiftUI test suites:
swift test --filter A2UISwiftUITests

# Format SwiftUI files:
swift-format format -i -r Package.swift swift/swiftui
```
