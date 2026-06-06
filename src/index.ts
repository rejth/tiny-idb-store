import { setByPath } from "./utils";

type TransactionOperation<T> = (store: IDBObjectStore) => Promise<T>;

export class BaseStore {
	constructor(
		protected readonly db: IDBDatabase,
		protected readonly storeName: string,
	) {}

	/** Opens a readonly object store for queries. */
	protected createReadStore(): IDBObjectStore {
		return this.db.transaction(this.storeName, "readonly").objectStore(this.storeName);
	}

	/** Yields every record value via a cursor. */
	protected async *cursorValues<T>(): AsyncGenerator<T> {
		const request = this.createReadStore().openCursor();

		while (true) {
			const cursor = await this.request(request);

			if (!cursor) {
				return;
			}

			yield cursor.value;
			cursor.continue();
		}
	}

	/** Opens a readwrite transaction for mutations. */
	protected createWriteTransaction(): IDBTransaction {
		return this.db.transaction(this.storeName, "readwrite");
	}

	/** Wraps an IDBRequest in a promise. */
	protected request<T>(request: IDBRequest<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			request.addEventListener("success", () => resolve(request.result), { once: true });
			request.addEventListener("error", () => reject(request.error), { once: true });
		});
	}

	/** Runs a write operation and waits for the transaction to complete. */
	protected async write<T>(operation: TransactionOperation<T>): Promise<T> {
		const transaction = this.createWriteTransaction();
		const store = transaction.objectStore(this.storeName);

		try {
			const result = await operation(store);

			await new Promise<void>((resolve, reject) => {
				transaction.addEventListener("complete", () => resolve(), { once: true });
				transaction.addEventListener("error", () => reject(transaction.error), { once: true });
				transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
			});

			return result;
		} catch (error) {
			if (transaction.error === null) {
				transaction.abort();
			}

			throw error;
		}
	}

	/** Inserts a new record and returns its generated key. */
	async add<T>(record: T): Promise<IDBValidKey> {
		return this.write((store) => this.request(store.add(record)));
	}

	/** Inserts multiple records in one transaction. */
	async bulkAdd<T>(records: T[]): Promise<IDBValidKey[]> {
		return this.write((store) => Promise.all(records.map((record) => this.request(store.add(record)))));
	}

	/** Replaces or upserts a full record by key. */
	async put<T>(record: T): Promise<IDBValidKey> {
		return this.write((store) => this.request(store.put(record)));
	}

	/** Replaces or upserts multiple records in one transaction. */
	async bulkPut<T>(records: T[]): Promise<IDBValidKey[]> {
		return this.write((store) => Promise.all(records.map((record) => this.request(store.put(record)))));
	}

	/** Reads a single record by key. */
	async get<T>(key: IDBValidKey): Promise<T | undefined> {
		return this.request(this.createReadStore().get(key));
	}

	/** Returns the number of records in the store. */
	async count(): Promise<number> {
		return this.request(this.createReadStore().count());
	}

	/** Returns every record in the store. */
	async getAll<T>(): Promise<T[]> {
		return this.request(this.createReadStore().getAll());
	}

	/** Returns records whose keys fall within an inclusive range. */
	async getAllFromTo<T>(fromKey: IDBValidKey, toKey: IDBValidKey): Promise<T[]> {
		return this.request(this.createReadStore().getAll(IDBKeyRange.bound(fromKey, toKey)));
	}

	/** Returns records with keys greater than the given key. */
	async getAllFrom<T>(fromKey: IDBValidKey): Promise<T[]> {
		return this.request(this.createReadStore().getAll(IDBKeyRange.lowerBound(fromKey, true)));
	}

	/** Returns keys greater than the given key. */
	async getAllKeysFrom(fromKey: IDBValidKey): Promise<IDBValidKey[]> {
		return this.request(this.createReadStore().getAllKeys(IDBKeyRange.lowerBound(fromKey, true)));
	}

	/** Returns records with keys less than the given key. */
	async getAllTo<T>(toKey: IDBValidKey): Promise<T[]> {
		return this.request(this.createReadStore().getAll(IDBKeyRange.upperBound(toKey, true)));
	}

	/** Returns keys less than the given key. */
	async getAllKeysTo(toKey: IDBValidKey): Promise<IDBValidKey[]> {
		return this.request(this.createReadStore().getAllKeys(IDBKeyRange.upperBound(toKey, true)));
	}

	/** Maps every record through one or more mapper functions. */
	async *mapAll<T, R>(mappers: Array<(value: T) => R>): AsyncGenerator<R> {
		for await (const value of this.cursorValues<T>()) {
			for (const mapper of mappers) {
				yield mapper(value);
			}
		}
	}

	/** Yields records that match the predicate. */
	async *findAllBy<T>(predicate: (value: T) => boolean): AsyncGenerator<T> {
		for await (const value of this.cursorValues<T>()) {
			if (predicate(value)) {
				yield value;
			}
		}
	}

	/** Yields up to the first N records. */
	async *takeByLimit<T>(limit: number): AsyncGenerator<T> {
		let count = 0;

		for await (const value of this.cursorValues<T>()) {
			if (count >= limit) {
				return;
			}

			yield value;
			count += 1;
		}
	}

	/** Maps records that match the predicate through one or more mappers. */
	async *reduce<T, R>(predicate: (value: T) => boolean, mappers: Array<(value: T) => R>): AsyncGenerator<R> {
		for await (const value of this.cursorValues<T>()) {
			if (predicate(value)) {
				for (const mapper of mappers) {
					yield mapper(value);
				}
			}
		}
	}

	/** Yields records between start and stop using an optional step. */
	async *sliceBy<T>(start: number, stop: number, step: number = 1): AsyncGenerator<T> {
		let index = 0;

		for await (const value of this.cursorValues<T>()) {
			if (index >= stop) {
				return;
			}

			if (index >= start && (index - start) % step === 0) {
				yield value;
			}

			index += 1;
		}
	}

	/** Removes every record from the store. */
	async clear(): Promise<void> {
		await this.write((store) => this.request(store.clear()));
	}

	/** Deletes a single record by key. */
	async delete(key: IDBValidKey): Promise<void> {
		await this.write((store) => this.request(store.delete(key)));
	}

	/** Deletes multiple records in one transaction. */
	async bulkDelete(keys: IDBValidKey[]): Promise<unknown[]> {
		return this.write((store) => Promise.all(keys.map((key) => this.request(store.delete(key)))));
	}

	/** Merges a partial patch into an existing record. Returns false when the key is missing. */
	async update<T extends Record<string, unknown>>(key: IDBValidKey, patch: Partial<T>): Promise<boolean> {
		const current = await this.get<T>(key);

		if (!current) {
			return false;
		}

		await this.put({ ...current, ...patch });
		return true;
	}

	/** Sets a nested field on an existing record. Returns false when the key is missing. */
	async updateByPath(key: IDBValidKey, path: string, value: unknown): Promise<boolean> {
		const current = await this.get<Record<string, unknown>>(key);

		if (!current) {
			return false;
		}

		setByPath(current, path, value);
		await this.put(current);

		return true;
	}

	/** Merges a partial patch into every record. Returns the number of updated records. */
	async updateAll<T extends Record<string, unknown>>(patch: Partial<T>): Promise<number> {
		return this.updateAllRecords((record) => {
			Object.assign(record, patch);
		});
	}

	/** Sets a nested field on every record. Returns the number of updated records. */
	async updateAllByPath(path: string, value: unknown): Promise<number> {
		return this.updateAllRecords((record) => {
			setByPath(record, path, value);
		});
	}

	/** Walks the store with a cursor and applies an in-place update to each record. */
	private async updateAllRecords(updateRecord: (record: Record<string, unknown>) => void): Promise<number> {
		return this.write(
			(store) =>
				new Promise<number>((resolve, reject) => {
					const request = store.openCursor();
					let updatedCount = 0;

					request.addEventListener("success", () => {
						const cursor = request.result;

						if (!cursor) {
							resolve(updatedCount);
							return;
						}

						const record = cursor.value as Record<string, unknown>;
						updateRecord(record);

						const updateRequest = cursor.update(record);
						updateRequest.addEventListener("success", () => {
							updatedCount += 1;
							cursor.continue();
						});
						updateRequest.addEventListener("error", () => reject(updateRequest.error), { once: true });
					});

					request.addEventListener("error", () => reject(request.error), { once: true });
				}),
		);
	}
}
