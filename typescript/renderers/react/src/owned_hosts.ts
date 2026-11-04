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

import type {HostOwner} from './host_registry';

/** A connected host element and the value its owner portals into it. */
export interface OwnedHostEntry<T> {
  readonly host: Element;
  readonly value: T;
  /** Tells the portals apart; stays the same while the host is registered. */
  readonly key: string;
}

/**
 * Host elements that a Web Component created, each registered under the nearest element React
 * rendered above it (its `HostOwner`). The React content beside that element portals into
 * them, so what they show renders in the app's React tree and reads its context.
 */
export class OwnedHosts<T> {
  private readonly hosts = new Map<Element, {entry: OwnedHostEntry<T>; owner: HostOwner}>();
  private readonly snapshots = new Map<HostOwner, readonly OwnedHostEntry<T>[]>();
  private readonly listeners = new Map<HostOwner, Set<() => void>>();
  private nextKey = 0;

  add(host: Element, value: T, owner: HostOwner): void {
    const current = this.hosts.get(host);
    if (current?.owner === owner && current.entry.value === value) return;
    const key = current?.entry.key ?? String(this.nextKey++);
    this.hosts.set(host, {entry: {host, value, key}, owner});
    if (current && current.owner !== owner) this.publish(current.owner);
    this.publish(owner);
  }

  delete(host: Element): void {
    const current = this.hosts.get(host);
    if (!current) return;
    this.hosts.delete(host);
    this.publish(current.owner);
  }

  subscribe(owner: HostOwner, listener: () => void): () => void {
    let listeners = this.listeners.get(owner);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(owner, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(owner);
        this.snapshots.delete(owner);
      }
    };
  }

  /** The hosts owned by `owner`; the same array until they change. */
  getSnapshot(owner: HostOwner): readonly OwnedHostEntry<T>[] {
    let snapshot = this.snapshots.get(owner);
    if (!snapshot) {
      snapshot = this.compute(owner);
      this.snapshots.set(owner, snapshot);
    }
    return snapshot;
  }

  private compute(owner: HostOwner): readonly OwnedHostEntry<T>[] {
    const result: OwnedHostEntry<T>[] = [];
    for (const {entry, owner: entryOwner} of this.hosts.values()) {
      if (entryOwner === owner) result.push(entry);
    }
    return result;
  }

  private publish(owner: HostOwner): void {
    if (!this.listeners.has(owner)) {
      this.snapshots.delete(owner);
      return;
    }
    this.snapshots.set(owner, this.compute(owner));
    for (const listener of this.listeners.get(owner) ?? []) listener();
  }
}
