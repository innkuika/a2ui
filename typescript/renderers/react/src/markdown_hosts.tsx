/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Renders the Markdown of web_core's `Text` through the component in
 * `MarkdownComponentContext`.
 *
 * web_core's basic catalog `Text` renders Markdown with a function that
 * returns HTML. When the app gives `MarkdownComponentContext` a component,
 * `A2uiSurface` registers `renderMarkdownHost`, which returns an
 * `<a2ui-react-markdown>` element holding the Markdown in an attribute. The
 * element registers under the nearest element React rendered above it (see
 * `HostOwner`), and the `ChildElement` that rendered that element portals the
 * component into it, so the component renders in the app's React tree and
 * reads the app's context.
 */

import React, {useCallback, useContext, useSyncExternalStore, type ComponentType} from 'react';
import {createPortal} from 'react-dom';
import type {MarkdownRenderer} from '@a2ui/web_core';
import {getMarkdownRenderer, setMarkdownRenderer} from '@a2ui/web_core/v0_9/basic_catalog';
import {type HostOwner, ownerAbove} from './host_registry';
import {MarkdownComponentContext, type MarkdownComponentProps} from './markdown-context';
import {OwnedHosts} from './owned_hosts';

const TAG = 'a2ui-react-markdown';
const ATTRIBUTE = 'data-markdown';

/** Markdown hosts, by the owner whose content portals them. */
const markdownHosts = new OwnedHosts<string>();

/**
 * Defines `<a2ui-react-markdown>` on first use, so importing the package does
 * not need a DOM.
 */
function defineMarkdownHost(): void {
  if (customElements.get(TAG)) return;
  customElements.define(
    TAG,
    class extends HTMLElement {
      connectedCallback() {
        this.style.display = 'contents';
        const owner = ownerAbove(this);
        if (owner) markdownHosts.add(this, this.getAttribute(ATTRIBUTE) ?? '', owner);
      }

      disconnectedCallback() {
        // Deferred, so re-parenting keeps the portal and its React state.
        queueMicrotask(() => {
          if (!this.isConnected) markdownHosts.delete(this);
        });
      }
    },
  );
}

/** Escapes text for a double-quoted HTML attribute value. */
function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** The Markdown renderer `A2uiSurface` registers with web_core for `MarkdownComponentContext`. */
export const renderMarkdownHost: MarkdownRenderer = async markdown => {
  defineMarkdownHost();
  return `<${TAG} ${ATTRIBUTE}="${escapeAttribute(markdown)}"></${TAG}>`;
};

/** How many mounted surfaces have registered `renderMarkdownHost`. */
let hostRendererUsers = 0;
/** The renderer web_core had before the first of those surfaces registered it. */
let rendererBeforeHosts: MarkdownRenderer | undefined;

/**
 * Registers `renderMarkdownHost` with web_core for a surface that has a
 * Markdown component, and returns the function that releases it. When the last
 * such surface releases it, the renderer web_core had before comes back, unless
 * something replaced `renderMarkdownHost` in the meantime.
 */
export function registerMarkdownHostRenderer(): () => void {
  if (hostRendererUsers++ === 0) {
    rendererBeforeHosts = getMarkdownRenderer();
  }
  setMarkdownRenderer(renderMarkdownHost);
  return () => {
    if (--hostRendererUsers === 0 && getMarkdownRenderer() === renderMarkdownHost) {
      setMarkdownRenderer(rendererBeforeHosts);
    }
  };
}

/**
 * Portals the component in `MarkdownComponentContext` into each Markdown host
 * owned by `owner`. Renders nothing when the context has no component.
 */
export const HostedMarkdown: React.FC<{owner: HostOwner}> = ({owner}) => {
  const Component = useContext(MarkdownComponentContext);
  return Component ? <MarkdownPortals owner={owner} component={Component} /> : null;
};

const MarkdownPortals: React.FC<{
  owner: HostOwner;
  component: ComponentType<MarkdownComponentProps>;
}> = ({owner, component: Component}) => {
  const subscribe = useCallback(
    (listener: () => void) => markdownHosts.subscribe(owner, listener),
    [owner],
  );
  const getSnapshot = useCallback(() => markdownHosts.getSnapshot(owner), [owner]);
  const hosts = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <>
      {hosts.map(({host, value, key}) => createPortal(<Component markdown={value} />, host, key))}
    </>
  );
};
