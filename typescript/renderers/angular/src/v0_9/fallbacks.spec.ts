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

import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {A2uiRendererService, A2UI_RENDERER_CONFIG} from '../core/a2ui-renderer.service';
import {SurfaceComponent} from '../core/surface.component';
import {MarkdownRenderer} from '../core/markdown';
import {BasicCatalog} from './catalog/basic/basic-catalog';
import {BasicCatalog as V1BasicCatalog} from '../basic-catalog';
import type {A2uiMessage} from '@a2ui/web_core/v0_9';

/** Renders each fallback as text naming its category and `info`. */
@Component({
  template: `
    <ng-template #pending let-info>
      @if (!(hideInList() && info.parentComponentType === 'List')) {
        <span class="pending"
          >pending {{ info.componentId }} in {{ info.parentComponentType ?? '-' }}</span
        >
      }
    </ng-template>
    <ng-template #error let-info>
      <span class="error">{{ info.error.type }} {{ info.error.componentType ?? '' }}</span>
    </ng-template>
    <a2ui-v09-surface
      surfaceId="s"
      [fallbacks]="withFallbacks() ? {pending: pending, error: error} : undefined"
    ></a2ui-v09-surface>
  `,
  imports: [SurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class FallbackTestHost {
  readonly withFallbacks = signal(true);
  readonly hideInList = signal(false);
}

async function settle(fixture: ComponentFixture<unknown>) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    await Promise.all(
      [...root.querySelectorAll('*')].map(
        e => (e as {updateComplete?: Promise<unknown>}).updateComplete,
      ),
    );
  }
  fixture.detectChanges();
}

function text(fixture: ComponentFixture<unknown>, selector: string): string[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll(selector)].map(e =>
    (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

for (const flavor of ['v0.9 Angular components', 'v1.0 universal elements'] as const) {
  const v1 = flavor === 'v1.0 universal elements';
  const version = v1 ? '1.0' : 'v0.9';
  const catalogId = v1
    ? 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json'
    : 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

  describe(`SurfaceComponent fallbacks (${flavor})`, () => {
    let fixture: ComponentFixture<FallbackTestHost>;
    let renderer: A2uiRendererService;

    function send(components: Array<Record<string, unknown>>) {
      renderer.processMessages([
        {version, updateComponents: {surfaceId: 's', components}},
      ] as unknown as A2uiMessage[]);
    }

    beforeEach(async () => {
      const catalog = v1 ? new V1BasicCatalog() : new BasicCatalog();
      await TestBed.configureTestingModule({
        imports: [FallbackTestHost],
        providers: [
          A2uiRendererService,
          {
            provide: A2UI_RENDERER_CONFIG,
            useValue: {catalogs: [catalog], useUniversalComponents: v1},
          },
          {provide: MarkdownRenderer, useValue: {render: (v: string) => Promise.resolve(v)}},
        ],
      }).compileComponents();
      renderer = TestBed.inject(A2uiRendererService);
      renderer.processMessages([
        {version, createSurface: {surfaceId: 's', catalogId}},
      ] as unknown as A2uiMessage[]);
      fixture = TestBed.createComponent(FallbackTestHost);
    });

    it('renders the pending template for the root before it arrives, then the root', async () => {
      await settle(fixture);
      expect(text(fixture, '.pending')).toEqual(['pending root in -']);

      send([{id: 'root', component: 'Text', text: 'Hello'}]);
      await settle(fixture);
      expect(text(fixture, '.pending')).toEqual([]);
      expect(fixture.nativeElement.textContent).toContain('Hello');
    });

    it('renders the error template for a root with an unknown type', async () => {
      send([{id: 'root', component: 'StarRating'}]);
      await settle(fixture);
      expect(text(fixture, '.error')).toEqual(['unknown-type StarRating']);
    });

    it('renders templates for nested children with their parent type, replaced on arrival', async () => {
      send([
        {id: 'root', component: 'Card', child: 'col'},
        {id: 'col', component: 'Column', children: ['title', 'late', 'stars', 'loop']},
        {id: 'title', component: 'Text', text: 'Weekend in Lisbon'},
        {id: 'stars', component: 'StarRating'},
        {id: 'loop', component: 'Row', children: ['loop']},
      ]);
      await settle(fixture);
      expect(text(fixture, '.pending')).toEqual(['pending late in Column']);
      expect(text(fixture, '.error')).toEqual(['unknown-type StarRating', 'cyclic']);

      send([{id: 'late', component: 'Text', text: 'Rated 4.8'}]);
      await settle(fixture);
      expect(text(fixture, '.pending')).toEqual([]);
      expect(fixture.nativeElement.textContent).toContain('Rated 4.8');
    });

    it('keeps the List item of a child whose template renders something', async () => {
      send([
        {id: 'root', component: 'List', listStyle: 'ordered', children: ['a', 'late']},
        {id: 'a', component: 'Text', text: 'A'},
      ]);
      await settle(fixture);
      const items: HTMLElement[] = [...fixture.nativeElement.querySelectorAll('li')];
      expect(items.length).toBe(2);
      expect(getComputedStyle(items[1]).display).not.toBe('none');
      expect(text(fixture, 'li .pending')).toEqual(['pending late in List']);
    });

    it('hides the List item of a child whose template renders no node', async () => {
      fixture.componentInstance.hideInList.set(true);
      send([
        {id: 'root', component: 'List', listStyle: 'ordered', children: ['a', 'late']},
        {id: 'a', component: 'Text', text: 'A'},
      ]);
      await settle(fixture);
      const visible = [...fixture.nativeElement.querySelectorAll('li')].filter(
        (li: HTMLElement) => getComputedStyle(li).display !== 'none',
      );
      expect(visible.length).toBe(1);
    });

    it('renders nothing for unresolved nodes without fallbacks', async () => {
      fixture.componentInstance.withFallbacks.set(false);
      send([{id: 'root', component: 'Column', children: ['late', 'stars']}]);
      send([{id: 'stars', component: 'StarRating'}]);
      await settle(fixture);
      expect(text(fixture, '.pending, .error')).toEqual([]);
      expect((fixture.nativeElement.textContent ?? '').trim()).toBe('');
    });
  });
}
