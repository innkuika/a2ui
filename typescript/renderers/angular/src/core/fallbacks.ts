/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ApplicationRef,
  EmbeddedViewRef,
  inject,
  Injectable,
  InjectionToken,
  OnDestroy,
  type Signal,
  TemplateRef,
} from '@angular/core';
import type {
  A2uiErrorInfo,
  A2uiFallbackRequest,
  A2uiPendingInfo,
  ComponentApi,
  SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {fallbackHost, registerFallbackRenderer} from '@a2ui/web_core/v0_9/universal';

/** The context a fallback template is rendered with, so `<ng-template let-info>` works. */
export interface A2uiFallbackContext<I> {
  $implicit: I;
}

/**
 * The templates a surface renders for nodes that can't render yet (`pending`, including the
 * root before it arrives) or at all (`error`). A missing template renders nothing, and so does
 * a template that renders no node (for example a false `@if`).
 */
export interface A2uiFallbackTemplates {
  pending?: TemplateRef<A2uiFallbackContext<A2uiPendingInfo>>;
  error?: TemplateRef<A2uiFallbackContext<A2uiErrorInfo>>;
}

/** A fallback template with the context to render it with. */
export interface A2uiFallbackView {
  template: TemplateRef<A2uiFallbackContext<unknown>>;
  context: A2uiFallbackContext<unknown>;
}

/**
 * The type of the component rendered at this point of the tree, for the component hosts below
 * it to report as their `parentComponentType`.
 */
export const A2UI_COMPONENT_TYPE = new InjectionToken<() => string | undefined>(
  'A2UI_COMPONENT_TYPE',
);

/**
 * Holds one surface's fallback templates for the component hosts below its
 * {@link SurfaceComponent}, and renders them for the Web Components of the surface, which
 * render their children themselves.
 */
@Injectable()
export class SurfaceFallbacks implements OnDestroy {
  private readonly appRef = inject(ApplicationRef);
  private source?: Signal<A2uiFallbackTemplates | undefined>;
  private readonly registrations = new Map<object, () => void>();

  /** Reads the templates from `source` from now on. */
  connect(source: Signal<A2uiFallbackTemplates | undefined>): void {
    this.source = source;
  }

  /** The template and context for `request`, or `undefined` when there is no template. */
  viewFor(request: A2uiFallbackRequest): A2uiFallbackView | undefined {
    const template = this.source?.()?.[request.category] as
      | TemplateRef<A2uiFallbackContext<unknown>>
      | undefined;
    return template ? {template, context: {$implicit: request.info}} : undefined;
  }

  /** Lets the Web Components of `surface` render these fallbacks, until this is destroyed. */
  registerFor(surface: SurfaceModel<ComponentApi>): void {
    if (this.registrations.has(surface)) return;
    this.registrations.set(
      surface,
      registerFallbackRenderer(surface, request => {
        const view = this.viewFor(request);
        if (!view) return null;
        defineFallbackHost();
        return fallbackHost(TAG, {appRef: this.appRef, view});
      }),
    );
  }

  ngOnDestroy(): void {
    for (const unregister of this.registrations.values()) unregister();
    this.registrations.clear();
  }
}

const TAG = 'a2ui-ng-fallback';

/**
 * Renders a fallback template inside a Web Component: the embedded view is created when the
 * host connects, attached to the application so it is change-detected, and destroyed when the
 * host leaves the document.
 */
class NgFallbackHost extends HTMLElement {
  appRef?: ApplicationRef;
  private current?: A2uiFallbackView;
  private embedded?: EmbeddedViewRef<A2uiFallbackContext<unknown>>;
  private renderedTemplate?: TemplateRef<A2uiFallbackContext<unknown>>;

  /** The template and context to render; assigned by `fallbackHost` on every parent render. */
  set view(view: A2uiFallbackView) {
    this.current = view;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.style.display = 'contents';
    this.render();
  }

  disconnectedCallback() {
    // Deferred, so re-parenting keeps the view and its state.
    queueMicrotask(() => {
      if (!this.isConnected) this.destroyView();
    });
  }

  private render() {
    const view = this.current;
    if (!view) return;
    if (this.embedded && this.renderedTemplate !== view.template) this.destroyView();
    if (!this.embedded) {
      this.embedded = view.template.createEmbeddedView({$implicit: view.context.$implicit});
      this.renderedTemplate = view.template;
      this.appRef?.attachView(this.embedded);
      this.embedded.detectChanges();
      this.append(...this.embedded.rootNodes);
    } else if (this.embedded.context.$implicit !== view.context.$implicit) {
      this.embedded.context.$implicit = view.context.$implicit;
      this.embedded.detectChanges();
    }
  }

  private destroyView() {
    if (!this.embedded) return;
    this.appRef?.detachView(this.embedded);
    this.embedded.destroy();
    this.embedded = undefined;
    this.replaceChildren();
    this.renderedTemplate = undefined;
  }
}

function defineFallbackHost(): void {
  if (!customElements.get(TAG)) customElements.define(TAG, NgFallbackHost);
}
