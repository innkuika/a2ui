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

import {describe, it, expect, vi} from 'vitest';
import React, {createContext, useContext} from 'react';
import {render, screen, act, waitFor} from '@testing-library/react';
import {z} from 'zod';
import {
  Catalog,
  CommonSchemas,
  ComponentModel,
  MessageProcessor,
  SurfaceModel,
  ChildListSchema,
  ComponentIdSchema,
} from '@a2ui/web_core/v0_9';
import {basicCatalog as webCoreBasicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {basicCatalog as v1BasicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {
  A2uiSurface,
  createComponentImplementation,
  type A2uiErrorInfo,
  type A2uiPendingInfo,
  type A2uiReactFallbacks,
  type ReactCatalogComponent,
} from '../../src';

const TextImpl = createComponentImplementation(
  {name: 'Text', schema: z.object({text: CommonSchemas.DynamicString.optional()})},
  ({props}) => <span>{String(props.text ?? '')}</span>,
);

const ColumnImpl = createComponentImplementation(
  {name: 'Column', schema: z.object({children: ChildListSchema.optional()})},
  ({props, buildChild}) => (
    <div data-testid="column">
      {(props.children as string[] | undefined)?.map((id, index) => (
        <React.Fragment key={`${id}-${index}`}>{buildChild(id)}</React.Fragment>
      ))}
    </div>
  ),
);

const CardImpl = createComponentImplementation(
  {name: 'Card', schema: z.object({child: ComponentIdSchema.optional()})},
  ({props, buildChild}) => (
    <div data-testid="card">{props.child ? buildChild(props.child as string) : null}</div>
  ),
);

/** Its schema doesn't mark `child` as a component id, so the reference stays unresolved. */
const UnmarkedParentImpl = createComponentImplementation(
  {name: 'UnmarkedParent', schema: z.object({child: z.string().optional()})},
  ({props, buildChild}) => <div>{props.child ? buildChild(props.child as string) : null}</div>,
);

const Theme = createContext('no provider');

function reactSurface(rootId?: string) {
  const catalog = new Catalog<ReactCatalogComponent>('fallback-react-test', '0.9', [
    TextImpl,
    ColumnImpl,
    CardImpl,
    UnmarkedParentImpl,
    webCoreBasicCatalog.components.get('List')!,
  ]);
  return new SurfaceModel<ReactCatalogComponent>(
    's',
    catalog,
    undefined,
    undefined,
    undefined,
    undefined,
    rootId,
  );
}

function add(surface: SurfaceModel, id: string, type: string, props: Record<string, unknown>) {
  surface.componentsModel.addComponent(
    new ComponentModel(id, type, props, surface.defaultCatalog!),
  );
}

/** Labels each fallback with its category and info, so tests can read both from the DOM. */
function recordingFallbacks() {
  const pending: A2uiPendingInfo[] = [];
  const errors: A2uiErrorInfo[] = [];
  const fallbacks: A2uiReactFallbacks = {
    pending: info => {
      pending.push(info);
      return (
        <i data-testid={`pending-${info.componentId}`}>
          {`pending ${info.componentId} in ${info.parentComponentType ?? '-'}`}
        </i>
      );
    },
    error: info => {
      errors.push(info);
      return <b data-testid={`error-${info.componentId}`}>{`error ${info.error.type}`}</b>;
    },
  };
  return {fallbacks, pending, errors};
}

describe('A2uiSurface fallbacks', () => {
  it('renders the pending fallback for the root before it arrives, then the root', () => {
    const surface = reactSurface('main');
    const {fallbacks, pending} = recordingFallbacks();
    render(<A2uiSurface surface={surface} fallbacks={fallbacks} />);
    expect(screen.getByTestId('pending-main')).toBeDefined();
    expect(pending.at(-1)).toEqual({componentId: 'main'});

    act(() => add(surface, 'main', 'Text', {text: 'Hello'}));
    expect(screen.queryByTestId('pending-main')).toBeNull();
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('renders the error fallback for a root with an unknown type', () => {
    const surface = reactSurface();
    add(surface, 'root', 'StarRating', {});
    const {fallbacks, errors} = recordingFallbacks();
    render(<A2uiSurface surface={surface} fallbacks={fallbacks} />);
    expect(screen.getByTestId('error-root')).toBeDefined();
    expect(errors.at(-1)).toEqual({
      componentId: 'root',
      error: {type: 'unknown-type', componentType: 'StarRating'},
    });
  });

  it('renders a pending child fallback with its parent type and upgrades it in place', () => {
    const surface = reactSurface();
    add(surface, 'root', 'Card', {child: 'col'});
    add(surface, 'col', 'Column', {children: ['title', 'late']});
    add(surface, 'title', 'Text', {text: 'Title'});
    const {fallbacks} = recordingFallbacks();
    render(<A2uiSurface surface={surface} fallbacks={fallbacks} />);
    const column = screen.getByTestId('column');
    expect(screen.getByTestId('pending-late').textContent).toBe('pending late in Column');

    act(() => add(surface, 'late', 'Text', {text: 'Arrived'}));
    expect(screen.queryByTestId('pending-late')).toBeNull();
    expect(screen.getByText('Arrived')).toBeDefined();
    expect(screen.getByTestId('column')).toBe(column);
  });

  it('renders the error fallback for unknown types and cycles below the root', () => {
    const surface = reactSurface();
    add(surface, 'root', 'Column', {children: ['stars', 'loop']});
    add(surface, 'stars', 'StarRating', {});
    add(surface, 'loop', 'Card', {child: 'loop'});
    const {fallbacks, errors} = recordingFallbacks();
    render(<A2uiSurface surface={surface} fallbacks={fallbacks} />);
    expect(screen.getByTestId('error-stars').textContent).toBe('error unknown-type');
    expect(screen.getByTestId('error-loop').textContent).toBe('error cyclic');
    expect(errors).toContainEqual({
      componentId: 'stars',
      parentComponentType: 'Column',
      error: {type: 'unknown-type', componentType: 'StarRating'},
    });
    expect(errors).toContainEqual({
      componentId: 'loop',
      parentComponentType: 'Card',
      error: {type: 'cyclic'},
    });
  });

  it('renders the error fallback for an unresolved child reference, still reported once', () => {
    const surface = reactSurface();
    const codes: string[] = [];
    surface.onError.subscribe(e => void codes.push(e.code));
    add(surface, 'root', 'UnmarkedParent', {child: 'kid'});
    add(surface, 'kid', 'Text', {text: 'never reached'});
    const {fallbacks, errors} = recordingFallbacks();
    render(<A2uiSurface surface={surface} fallbacks={fallbacks} />);
    expect(screen.getByTestId('error-kid').textContent).toBe('error unresolved-reference');
    expect(errors.at(-1)).toEqual({
      componentId: 'kid',
      parentComponentType: 'UnmarkedParent',
      error: {type: 'unresolved-reference'},
    });
    expect(codes.filter(c => c === 'UNRESOLVED_CHILD_REFERENCE')).toHaveLength(1);
  });

  it('renders nothing when a builder returns null or throws', () => {
    const surface = reactSurface();
    add(surface, 'root', 'Column', {children: ['late', 'stars']});
    add(surface, 'stars', 'StarRating', {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const {container} = render(
        <A2uiSurface
          surface={surface}
          fallbacks={{
            pending: () => null,
            error: () => {
              throw new Error('boom');
            },
          }}
        />,
      );
      expect(screen.getByTestId('column').childNodes).toHaveLength(0);
      expect(container.textContent).toBe('');
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('gives a pending child of a web_core List an item showing its fallback, in the React tree', async () => {
    const surface = reactSurface();
    add(surface, 'root', 'List', {children: ['a', 'late']});
    add(surface, 'a', 'Text', {text: 'A'});
    const ThemedSkeleton = ({id}: {id: string}) => (
      <i data-testid={`skeleton-${id}`}>{useContext(Theme)}</i>
    );
    const fallbacks: A2uiReactFallbacks = {
      pending: info =>
        info.parentComponentType === 'List' ? <ThemedSkeleton id={info.componentId} /> : null,
    };
    const {container} = render(
      <Theme.Provider value="from app">
        <A2uiSurface surface={surface} fallbacks={fallbacks} />
      </Theme.Provider>,
    );
    const items = () => container.querySelectorAll('.a2ui-list-item-none');
    await waitFor(() => expect(screen.getByTestId('skeleton-late')).toBeDefined());
    expect(items()).toHaveLength(2);
    expect(items()[1].textContent).toBe('from app');

    await act(async () => add(surface, 'late', 'Text', {text: 'Late'}));
    await waitFor(() => expect(items()[1]?.textContent).toBe('Late'));
    expect(screen.queryByTestId('skeleton-late')).toBeNull();
  });

  it('gives a child of a web_core List no item when its fallback renders nothing', async () => {
    const surface = reactSurface();
    add(surface, 'root', 'List', {children: ['a', 'late']});
    add(surface, 'a', 'Text', {text: 'A'});
    const {container} = render(<A2uiSurface surface={surface} fallbacks={{pending: () => null}} />);
    await waitFor(() => expect(container.textContent).toContain('A'));
    expect(container.querySelectorAll('.a2ui-list-item-none')).toHaveLength(1);
  });

  it('renders fallbacks inside v1.0 universal basic catalog elements', async () => {
    const processor = new MessageProcessor([v1BasicCatalog]);
    processor.processMessages([
      {version: '1.0', createSurface: {surfaceId: 'v1', catalogId: v1BasicCatalog.id}},
      {
        version: '1.0',
        updateComponents: {
          surfaceId: 'v1',
          components: [
            {id: 'root', component: 'Card', child: 'col'},
            {id: 'col', component: 'Column', children: ['title', 'late', 'stars']},
            {id: 'title', component: 'Text', text: 'Weekend in Lisbon'},
            {id: 'stars', component: 'StarRating'},
          ],
        },
      },
    ]);
    const {fallbacks, pending, errors} = recordingFallbacks();
    render(<A2uiSurface surface={processor.model.getSurface('v1')!} fallbacks={fallbacks} />);
    await waitFor(() => expect(screen.getByTestId('pending-late')).toBeDefined());
    expect(screen.getByTestId('error-stars')).toBeDefined();
    expect(pending).toContainEqual({componentId: 'late', parentComponentType: 'Column'});
    expect(errors).toContainEqual({
      componentId: 'stars',
      parentComponentType: 'Column',
      error: {type: 'unknown-type', componentType: 'StarRating'},
    });
  });
});
