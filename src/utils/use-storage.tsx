/**
 * Source: https://gist.github.com/Ephys/79974c286e92665dcaae9c8f5344afaf
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { isFunction } from '@sequelize/utils';

const eventTargets = new WeakMap();

function getEventTarget(storage: Storage) {
  if (eventTargets.has(storage)) {
    return eventTargets.get(storage);
  }

  let eventTarget;
  try {
    eventTarget = new EventTarget();
  } catch {
    // fallback to a div as EventTarget on Safari
    // because EventTarget is not constructable on Safari
    eventTarget = document.createElement('div');
  }

  eventTargets.set(storage, eventTarget);

  return eventTarget;
}

export type StorageSetValue<T> = (newValue: T | undefined | ((oldValue: T) => T)) => void;

export type JsonSerializable =
  | number
  | boolean
  | string
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

type StorageHook = <T extends JsonSerializable>(
  key: string,
  defaultValue: T,
) => [T, StorageSetValue<T>];

let lastHookId = 0;

export function createStorageHook(storage: Storage = new Storage()): StorageHook {
  // window.onstorage only triggers cross-realm. This is used to notify other useLocalStorage on the same page that it changed

  return function useStorage<T extends JsonSerializable>(
    key: string,
    defaultValue: T,
  ): [/* get */ T, /* set */ StorageSetValue<T>] {
    const hookIdRef = useRef<number | null>(null);
    if (hookIdRef.current === null) {
      hookIdRef.current = lastHookId++;
    }

    const defaultValueRef = useRef(Object.freeze(defaultValue));
    const eventTarget = getEventTarget(storage);

    const [internalValue, setInternalValue] = useState(() => {
      const _value = storage.getItem(key);

      if (_value == null) {
        return defaultValueRef.current;
      }

      try {
        return JSON.parse(_value);
      } catch (error) {
        console.error('use-local-storage: invalid stored value format, resetting to default');
        console.error(error);

        return defaultValueRef.current;
      }
    });

    const currentValue = useRef(internalValue);
    currentValue.current = internalValue;

    const setValue: StorageSetValue<T> = useCallback(
      (val: T | undefined | ((oldVal: T) => T)) => {
        if (isFunction(val)) {
          val = val(currentValue.current);
        }

        if (currentValue.current === val) {
          return;
        }

        // removeItem
        if (val === undefined) {
          currentValue.current = defaultValueRef.current;
          setInternalValue(defaultValueRef.current);

          if (storage.getItem(key) == null) {
            return;
          }

          storage.removeItem(key);
        } else {
          const stringified = JSON.stringify(val);
          currentValue.current = val;
          setInternalValue(val);

          if (stringified === storage.getItem(key)) {
            return;
          }

          storage.setItem(key, stringified);
        }

        eventTarget.dispatchEvent(
          new CustomEvent(`uls:storage:${key}`, {
            detail: { val, sourceHook: hookIdRef.current },
          }),
        );
      },
      [eventTarget, key],
    );

    useEffect(() => {
      function crossRealmOnChange(e: StorageEvent) {
        if (e.key !== key) {
          return;
        }

        try {
          if (e.newValue == null) {
            setValue(undefined);

            return;
          }

          setValue(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }

      function sameRealmOnChange(e: CustomEvent) {
        // don't act on events we sent
        if (e.detail.sourceHook === hookIdRef.current) {
          return;
        }

        setValue(e.detail.val); // "val" is wrapped in an object to prevent undefined from being translated into null
      }

      eventTarget.addEventListener(`uls:storage:${key}`, sameRealmOnChange);
      window.addEventListener('storage', crossRealmOnChange);

      return () => {
        eventTarget.removeEventListener(`uls:storage:${key}`, sameRealmOnChange);
        window.removeEventListener('storage', crossRealmOnChange);
      };
    }, [eventTarget, key, setValue]);

    return [internalValue, setValue];
  };
}

function ssrHook<T extends JsonSerializable>(
  key: string,
  defaultValue: T,
): [T, StorageSetValue<T>] {
  return [
    defaultValue,
    () => {
      throw new Error('setState is not supposed to be called server-side.');
    },
  ];
}

export const useLocalStorage: StorageHook =
  // eslint-disable-next-line no-restricted-syntax -- checking that the variable exists is an acceptable exception
  typeof window !== 'undefined' && typeof localStorage !== 'undefined'
    ? createStorageHook(localStorage)
    : ssrHook;

export const useSessionStorage: StorageHook =
  // eslint-disable-next-line no-restricted-syntax -- checking that the variable exists is an acceptable exception
  typeof window !== 'undefined' && typeof localStorage !== 'undefined'
    ? createStorageHook(sessionStorage)
    : ssrHook;
