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

/**
 * Renders a surface's fallbacks (`A2uiSurface`'s `fallbacks` prop) in place of unresolved
 * nodes.
 *
 * React renders a fallback directly wherever it renders a node itself: `FallbackView` reads
 * the builders from `FallbacksContext`. A Web Component (such as a basic catalog `Column`)
 * renders its children itself, so `A2uiSurface` registers a fallback renderer with web_core
 * for it. That renderer returns an `<a2ui-react-fallback>` host holding the builder's view;
 * the host registers under the nearest element React rendered above it (see `HostOwner`), and
 * the `ChildElement` that rendered that element portals the view into it.
 */

import type React from 'react';
import {createContext, useCallback, useContext, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {buildFallback, type A2uiFallbackRequest, type A2uiFallbacks} from '@a2ui/web_core/v0_9';
import {fallbackHost, type A2uiFallbackRenderer} from '@a2ui/web_core/v0_9/universal';
import {type HostOwner, ownerAbove} from './host_registry';
import {OwnedHosts} from './owned_hosts';

/** The UI `A2uiSurface` shows for nodes that can't render yet, or at all. */
export type A2uiReactFallbacks = A2uiFallbacks<React.ReactNode>;

export const FallbacksContext = createContext<A2uiReactFallbacks | undefined>(undefined);

/** Renders the surface's fallback for `request`, or nothing. */
export const FallbackView: React.FC<{request: A2uiFallbackRequest}> = ({request}) => {
  const fallbacks = useContext(FallbacksContext);
  return <>{buildFallback(fallbacks, request) ?? null}</>;
};

const TAG = 'a2ui-react-fallback';
const fallbackHosts = new OwnedHosts<React.ReactNode>();

/** Defines `<a2ui-react-fallback>` on first use, so importing the package needs no DOM. */
function defineFallbackHost(): void {
  if (customElements.get(TAG)) return;
  customElements.define(
    TAG,
    class extends HTMLElement {
      private currentView: React.ReactNode = null;

      /** The view to portal into this host; assigned by `fallbackHost` on every render. */
      set view(view: React.ReactNode) {
        this.currentView = view;
        if (this.isConnected) this.register();
      }

      get view(): React.ReactNode {
        return this.currentView;
      }

      connectedCallback() {
        this.style.display = 'contents';
        this.register();
      }

      disconnectedCallback() {
        // Deferred, so re-parenting keeps the portal and its React state.
        queueMicrotask(() => {
          if (!this.isConnected) fallbackHosts.delete(this);
        });
      }

      private register() {
        const owner = ownerAbove(this);
        if (owner) fallbackHosts.add(this, this.currentView, owner);
      }
    },
  );
}

/**
 * The fallback renderer `A2uiSurface` registers with web_core: a host for the builder's view,
 * or nothing when the builder returns nothing, so a container leaves that child out.
 */
export function createFallbackRenderer(
  getFallbacks: () => A2uiReactFallbacks | undefined,
): A2uiFallbackRenderer {
  return request => {
    const view = buildFallback(getFallbacks(), request);
    if (view === undefined) return null;
    defineFallbackHost();
    return fallbackHost(TAG, {view});
  };
}

/** Portals the view of each fallback host owned by `owner`. */
export const HostedFallbacks: React.FC<{owner: HostOwner}> = ({owner}) => {
  const subscribe = useCallback(
    (listener: () => void) => fallbackHosts.subscribe(owner, listener),
    [owner],
  );
  const getSnapshot = useCallback(() => fallbackHosts.getSnapshot(owner), [owner]);
  const hosts = useSyncExternalStore(subscribe, getSnapshot);
  return <>{hosts.map(({host, value, key}) => createPortal(value, host, key))}</>;
};
