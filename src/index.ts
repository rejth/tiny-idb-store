import { setByPath } from './utils'

type TransactionOperation<T> = (store: IDBObjectStore) => Promise<T>

export class BaseStore {
  constructor(
    protected readonly db: IDBDatabase,
    protected readonly storeName: string,
  ) {}

  protected createReadStore(): IDBObjectStore {
    return this.db.transaction(this.storeName, 'readonly').objectStore(this.storeName)
  }

  protected async *cursorValues<T>(): AsyncGenerator<T> {
    const request = this.createReadStore().openCursor()

    while (true) {
      const cursor = await this.request(request)

      if (!cursor) {
        return
      }

      yield cursor.value
      cursor.continue()
    }
  }

  protected createWriteTransaction(): IDBTransaction {
    return this.db.transaction(this.storeName, 'readwrite')
  }

  protected request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  protected async write<T>(operation: TransactionOperation<T>): Promise<T> {
    const transaction = this.createWriteTransaction()
    const store = transaction.objectStore(this.storeName)

    try {
      const result = await operation(store)

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })

      return result
    } catch (error) {
      if (transaction.error === null) {
        transaction.abort()
      }

      throw error
    }
  }

  async add<T>(record: T): Promise<IDBValidKey> {
    return this.write((store) => this.request(store.add(record)))
  }

  async bulkAdd<T>(records: T[]): Promise<IDBValidKey[]> {
    return this.write((store) =>
      Promise.all(records.map((record) => this.request(store.add(record)))),
    )
  }

  async put<T>(record: T): Promise<IDBValidKey> {
    return this.write((store) => this.request(store.put(record)))
  }

  async bulkPut<T>(records: T[]): Promise<IDBValidKey[]> {
    return this.write((store) =>
      Promise.all(records.map((record) => this.request(store.put(record)))),
    )
  }

  async get<T>(key: IDBValidKey): Promise<T | undefined> {
    return this.request(this.createReadStore().get(key))
  }

  async count(): Promise<number> {
    return this.request(this.createReadStore().count())
  }

  async getAll<T>(): Promise<T[]> {
    return this.request(this.createReadStore().getAll())
  }

  async getAllFromTo<T>(fromKey: IDBValidKey, toKey: IDBValidKey): Promise<T[]> {
    return this.request(this.createReadStore().getAll(IDBKeyRange.bound(fromKey, toKey)))
  }

  async getAllFrom<T>(fromKey: IDBValidKey): Promise<T[]> {
    return this.request(this.createReadStore().getAll(IDBKeyRange.lowerBound(fromKey, true)))
  }

  async getAllKeysFrom(fromKey: IDBValidKey): Promise<IDBValidKey[]> {
    return this.request(this.createReadStore().getAllKeys(IDBKeyRange.lowerBound(fromKey, true)))
  }

  async getAllTo<T>(toKey: IDBValidKey): Promise<T[]> {
    return this.request(this.createReadStore().getAll(IDBKeyRange.upperBound(toKey, true)))
  }

  async getAllKeysTo(toKey: IDBValidKey): Promise<IDBValidKey[]> {
    return this.request(this.createReadStore().getAllKeys(IDBKeyRange.upperBound(toKey, true)))
  }

  async *mapAll<T, R>(mappers: Array<(value: T) => R>): AsyncGenerator<R> {
    for await (const value of this.cursorValues<T>()) {
      for (const mapper of mappers) {
        yield mapper(value)
      }
    }
  }

  async *findAllBy<T>(predicate: (value: T) => boolean): AsyncGenerator<T> {
    for await (const value of this.cursorValues<T>()) {
      if (predicate(value)) {
        yield value
      }
    }
  }

  async *takeByLimit<T>(limit: number): AsyncGenerator<T> {
    let count = 0

    for await (const value of this.cursorValues<T>()) {
      if (count >= limit) {
        return
      }

      yield value
      count += 1
    }
  }

  async *reduce<T, R>(
    predicate: (value: T) => boolean,
    mappers: Array<(value: T) => R>,
  ): AsyncGenerator<R> {
    for await (const value of this.cursorValues<T>()) {
      if (predicate(value)) {
        for (const mapper of mappers) {
          yield mapper(value)
        }
      }
    }
  }

  async *sliceBy<T>(start: number, stop: number, step: number = 1): AsyncGenerator<T> {
    let index = 0

    for await (const value of this.cursorValues<T>()) {
      if (index >= stop) {
        return
      }

      if (index >= start && (index - start) % step === 0) {
        yield value
      }

      index += 1
    }
  }

  async clear(): Promise<void> {
    await this.write((store) => this.request(store.clear()))
  }

  async delete(key: IDBValidKey): Promise<void> {
    await this.write((store) => this.request(store.delete(key)))
  }

  async bulkDelete(keys: IDBValidKey[]): Promise<unknown[]> {
    return this.write((store) => Promise.all(keys.map((key) => this.request(store.delete(key)))))
  }

  async update<T extends Record<string, unknown>>(
    key: IDBValidKey,
    patch: Partial<T>,
  ): Promise<boolean> {
    const current = await this.get<T>(key)

    if (!current) {
      return false
    }

    await this.put({ ...current, ...patch })
    return true
  }

  async updateByPath(key: IDBValidKey, path: string, value: unknown): Promise<boolean> {
    const current = await this.get<Record<string, unknown>>(key)

    if (!current) {
      return false
    }

    setByPath(current, path, value)
    await this.put(current)

    return true
  }

  async updateAll<T extends Record<string, unknown>>(patch: Partial<T>): Promise<number> {
    return this.updateAllRecords((record) => {
      Object.assign(record, patch)
    })
  }

  async updateAllByPath(path: string, value: unknown): Promise<number> {
    return this.updateAllRecords((record) => {
      setByPath(record, path, value)
    })
  }

  private async updateAllRecords(
    updateRecord: (record: Record<string, unknown>) => void,
  ): Promise<number> {
    return this.write(
      (store) =>
        new Promise<number>((resolve, reject) => {
          const request = store.openCursor()
          let updatedCount = 0

          request.onsuccess = () => {
            const cursor = request.result

            if (!cursor) {
              resolve(updatedCount)
              return
            }

            const record = cursor.value as Record<string, unknown>
            updateRecord(record)

            const updateRequest = cursor.update(record)
            updateRequest.onsuccess = () => {
              updatedCount += 1
              cursor.continue()
            }
            updateRequest.onerror = () => reject(updateRequest.error)
          }
          request.onerror = () => reject(request.error)
        }),
    )
  }
}
