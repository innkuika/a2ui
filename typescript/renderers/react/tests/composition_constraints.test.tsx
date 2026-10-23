/*
 * Copyright 2026 Google LLC
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

import {describe, it, expect} from 'vitest';
import {z} from 'zod';
import {
  createBinderlessComponentImplementation,
  createComponentImplementation,
  type ReactComponentImplementation,
} from '../src/index';
import {A2uiValidationError, Catalog, type ComponentApi, MessageProcessor} from '@a2ui/web_core';
import {CommonSchemas} from '@a2ui/web_core/v1_0';

const CATALOG_ID = 'https://example.com/catalogs/composition';

const RuneApi = {
  name: 'Rune',
  schema: z.object({}),
  allowedParents: ['Card'],
};
const CardApi = {
  name: 'Card',
  schema: z.object({child: CommonSchemas.ComponentId}),
  allowedChildren: ['Rune'],
};
const LabelApi = {name: 'Label', schema: z.object({})};

const helpers: Record<string, (api: ComponentApi) => ReactComponentImplementation> = {
  createComponentImplementation: api => createComponentImplementation(api, () => null),
  createBinderlessComponentImplementation: api =>
    createBinderlessComponentImplementation(api, () => null),
};

function createSurface(
  components: ReactComponentImplementation[],
  surfaceComponents: Array<{id: string; component: string; [prop: string]: unknown}>,
): void {
  const processor = new MessageProcessor([new Catalog(CATALOG_ID, '1.0', components, [])]);
  processor.processMessages([
    {
      version: 'v1.0',
      createSurface: {surfaceId: 's', catalogId: CATALOG_ID, components: surfaceComponents},
    },
  ]);
}

function validationCode(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof A2uiValidationError) return e.code;
    throw e;
  }
  return undefined;
}

describe.each(Object.entries(helpers))('%s composition constraints', (_, create) => {
  it('keeps allowedParents and allowedChildren from the API', () => {
    expect(create(RuneApi).allowedParents).toEqual(['Card']);
    expect(create(CardApi).allowedChildren).toEqual(['Rune']);
  });

  it('rejects a component under a parent outside allowedParents', () => {
    expect(
      validationCode(() => createSurface([create(RuneApi)], [{id: 'root', component: 'Rune'}])),
    ).toBe('UNALLOWED_PARENT');
  });

  it('rejects a child outside allowedChildren', () => {
    expect(
      validationCode(() =>
        createSurface(
          [create(CardApi), create(LabelApi)],
          [
            {id: 'root', component: 'Card', child: 'label'},
            {id: 'label', component: 'Label'},
          ],
        ),
      ),
    ).toBe('UNALLOWED_CHILD');
  });

  it('accepts a composition the constraints allow', () => {
    expect(
      validationCode(() =>
        createSurface(
          [create(CardApi), create(RuneApi)],
          [
            {id: 'root', component: 'Card', child: 'rune'},
            {id: 'rune', component: 'Rune'},
          ],
        ),
      ),
    ).toBeUndefined();
  });
});
