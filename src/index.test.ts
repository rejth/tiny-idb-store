import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "vitest";

import { BaseStore } from "./index";

type Note = {
	id?: number;
	title: string;
};

type DocumentRecord = {
	uuid: string;
	meta?: {
		status?: string;
	};
	title: string;
};

class NotesStore extends BaseStore {
	constructor(db: IDBDatabase) {
		super(db, "notes");
	}
}

class DocumentsStore extends BaseStore {
	constructor(db: IDBDatabase) {
		super(db, "documents");
	}
}

const openTestDb = (name: string): Promise<IDBDatabase> => {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, 1);

		request.addEventListener("error", () => reject(request.error), { once: true });
		request.addEventListener("success", () => resolve(request.result), { once: true });
		request.addEventListener("upgradeneeded", () => {
			request.result.createObjectStore("notes", {
				keyPath: "id",
				autoIncrement: true,
			});

			request.result.createObjectStore("documents", { keyPath: "uuid" });
		});
	});
};

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
	const results: T[] = [];

	for await (const value of iterable) {
		results.push(value);
	}

	return results;
};

describe("BaseStore", () => {
	let db: IDBDatabase | undefined;

	afterEach(() => {
		db?.close();
		db = undefined;
	});

	test("added records can be retrieved by their generated key", async () => {
		db = await openTestDb("tiny-idb-store-tracer");
		const store = new NotesStore(db);

		const id = await store.add<Note>({ title: "First note" });

		await expect(store.get<Note>(id)).resolves.toEqual({
			id,
			title: "First note",
		});
	});

	test("records can be counted, listed, and cleared", async () => {
		db = await openTestDb("tiny-idb-store-collection-state");
		const store = new NotesStore(db);

		await store.add<Note>({ title: "First note" });
		await store.add<Note>({ title: "Second note" });

		await expect(store.count()).resolves.toBe(2);
		await expect(store.getAll<Note>()).resolves.toEqual([
			{ id: 1, title: "First note" },
			{ id: 2, title: "Second note" },
		]);

		await store.clear();

		await expect(store.count()).resolves.toBe(0);
		await expect(store.getAll<Note>()).resolves.toEqual([]);
	});

	test("records can be replaced and deleted by key", async () => {
		db = await openTestDb("tiny-idb-store-replace-delete");
		const store = new NotesStore(db);

		const id = await store.add<Note>({ title: "Draft" });

		await store.put<Note>({ id: Number(id), title: "Published" });
		await expect(store.get<Note>(id)).resolves.toEqual({
			id,
			title: "Published",
		});

		await store.delete(id);

		await expect(store.get<Note>(id)).resolves.toBeUndefined();
		await expect(store.count()).resolves.toBe(0);
	});

	test("bulk added records are committed atomically", async () => {
		db = await openTestDb("tiny-idb-store-bulk-add");
		const store = new NotesStore(db);

		await expect(store.bulkAdd<Note>([{ title: "One" }, { title: "Two" }])).resolves.toEqual([1, 2]);
		await expect(store.getAll<Note>()).resolves.toEqual([
			{ id: 1, title: "One" },
			{ id: 2, title: "Two" },
		]);

		await expect(
			store.bulkAdd<Note>([
				{ id: 3, title: "Three" },
				{ id: 1, title: "Duplicate" },
			]),
		).rejects.toBeInstanceOf(DOMException);

		await expect(store.getAll<Note>()).resolves.toEqual([
			{ id: 1, title: "One" },
			{ id: 2, title: "Two" },
		]);
	});

	test("bulk records can be replaced and deleted", async () => {
		db = await openTestDb("tiny-idb-store-bulk-put-delete");
		const store = new NotesStore(db);

		await store.bulkAdd<Note>([{ title: "One" }, { title: "Two" }, { title: "Three" }]);

		await expect(
			store.bulkPut<Note>([
				{ id: 1, title: "First" },
				{ id: 2, title: "Second" },
			]),
		).resolves.toEqual([1, 2]);

		await store.bulkDelete([1, 3]);

		await expect(store.getAll<Note>()).resolves.toEqual([{ id: 2, title: "Second" }]);
	});

	test("records and keys can be read by key ranges", async () => {
		db = await openTestDb("tiny-idb-store-key-ranges");
		const store = new NotesStore(db);

		await store.bulkAdd<Note>([{ title: "One" }, { title: "Two" }, { title: "Three" }, { title: "Four" }]);

		await expect(store.getAllFromTo<Note>(2, 4)).resolves.toEqual([
			{ id: 2, title: "Two" },
			{ id: 3, title: "Three" },
			{ id: 4, title: "Four" },
		]);
		await expect(store.getAllFrom<Note>(2)).resolves.toEqual([
			{ id: 3, title: "Three" },
			{ id: 4, title: "Four" },
		]);
		await expect(store.getAllKeysFrom(2)).resolves.toEqual([3, 4]);
		await expect(store.getAllTo<Note>(3)).resolves.toEqual([
			{ id: 1, title: "One" },
			{ id: 2, title: "Two" },
		]);
		await expect(store.getAllKeysTo(3)).resolves.toEqual([1, 2]);
	});

	test("records can be traversed with cursor helpers", async () => {
		db = await openTestDb("tiny-idb-store-cursors");
		const store = new NotesStore(db);

		await store.bulkAdd<Note>([{ title: "One" }, { title: "Two" }, { title: "Three" }, { title: "Four" }]);

		await expect(collect(store.mapAll<Note, string>([(note) => note.title.toUpperCase()]))).resolves.toEqual([
			"ONE",
			"TWO",
			"THREE",
			"FOUR",
		]);
		await expect(collect(store.findAllBy<Note>((note) => note.title.includes("o")))).resolves.toEqual([
			{ id: 2, title: "Two" },
			{ id: 4, title: "Four" },
		]);
		await expect(collect(store.takeByLimit<Note>(2))).resolves.toEqual([
			{ id: 1, title: "One" },
			{ id: 2, title: "Two" },
		]);
		await expect(
			collect(store.reduce<Note, string>((note) => note.title.length === 3, [(note) => note.title])),
		).resolves.toEqual(["One", "Two"]);
		await expect(collect(store.sliceBy<Note>(1, 4, 2))).resolves.toEqual([
			{ id: 2, title: "Two" },
			{ id: 4, title: "Four" },
		]);
	});

	describe("updateAllRecords", () => {
		test("updateAll returns 0 for an empty store", async () => {
			db = await openTestDb("tiny-idb-store-update-all-empty");
			const store = new DocumentsStore(db);

			await expect(store.updateAll<DocumentRecord>({ title: "No records" })).resolves.toBe(0);
		});

		test("updateAll patches every record and preserves unpatched fields", async () => {
			db = await openTestDb("tiny-idb-store-update-all-patch");
			const store = new DocumentsStore(db);

			await store.bulkAdd<DocumentRecord>([
				{ uuid: "a", title: "Alpha", meta: { status: "draft" } },
				{ uuid: "b", title: "Beta", meta: { status: "draft" } },
			]);

			await expect(store.updateAll<DocumentRecord>({ title: "Updated" })).resolves.toBe(2);
			await expect(store.getAll<DocumentRecord>()).resolves.toEqual([
				{ uuid: "a", title: "Updated", meta: { status: "draft" } },
				{ uuid: "b", title: "Updated", meta: { status: "draft" } },
			]);
		});

		test("updateAllByPath returns 0 for an empty store", async () => {
			db = await openTestDb("tiny-idb-store-update-all-by-path-empty");
			const store = new DocumentsStore(db);

			await expect(store.updateAllByPath("meta.status", "synced")).resolves.toBe(0);
		});

		test("updateAllByPath sets nested values and creates missing objects", async () => {
			db = await openTestDb("tiny-idb-store-update-all-by-path-nested");
			const store = new DocumentsStore(db);

			await store.bulkAdd<DocumentRecord>([
				{ uuid: "a", title: "Alpha" },
				{ uuid: "b", title: "Beta", meta: { status: "draft" } },
			]);

			await expect(store.updateAllByPath("meta.status", "synced")).resolves.toBe(2);
			await expect(store.getAll<DocumentRecord>()).resolves.toEqual([
				{ uuid: "a", title: "Alpha", meta: { status: "synced" } },
				{ uuid: "b", title: "Beta", meta: { status: "synced" } },
			]);
		});
	});

	test("records can be updated without assuming an id field", async () => {
		db = await openTestDb("tiny-idb-store-update-contract");
		const store = new DocumentsStore(db);

		await store.bulkAdd<DocumentRecord>([
			{ uuid: "a", title: "Alpha" },
			{ uuid: "b", title: "Beta" },
		]);

		await expect(store.update<DocumentRecord>("a", { title: "Updated alpha" })).resolves.toBe(true);
		await expect(store.update<DocumentRecord>("missing", { title: "Missing" })).resolves.toBe(false);
		await expect(store.updateByPath("b", "meta.status", "ready")).resolves.toBe(true);
		await expect(store.updateAll<DocumentRecord>({ title: "Every document" })).resolves.toBe(2);
		await expect(store.updateAllByPath("meta.status", "synced")).resolves.toBe(2);

		await expect(store.getAll<DocumentRecord>()).resolves.toEqual([
			{ uuid: "a", title: "Every document", meta: { status: "synced" } },
			{ uuid: "b", title: "Every document", meta: { status: "synced" } },
		]);
	});
});
