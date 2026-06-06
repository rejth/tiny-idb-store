# tiny-idb-store

IndexedDB object-store wrapper with promise-based CRUD, bulk, cursor, range, and update helpers.

## Install

```sh
npm install tiny-idb-store
```

## Scripts

- `npm run test` — run the Vitest suite with fake IndexedDB
- `npm run build` — emit ESM JavaScript and TypeScript declarations to `dist`
- `npm run lint` — run Biome and Oxlint
- `npm run lint:fix` — auto-format with Biome
- `npm run check` — lint, test, and build

## Usage

```ts
import { BaseStore } from "tiny-idb-store";

interface Note {
	id?: number;
	title: string;
}

class NotesStore extends BaseStore {
	constructor(db: IDBDatabase) {
		super(db, "notes");
	}
}

class StorageService {
	private static instance: StorageService | null = null;

	private db: IDBDatabase | null = null;
	private notesStore: NotesStore | null = null;
	private readonly name = "notes-db";
	private readonly version = 1;

	private constructor() {}

	get notes(): NotesStore {
		if (!this.notesStore) {
			throw new Error("StorageService is not initialized.");
		}

		return this.notesStore;
	}

	static async create(): Promise<StorageService> {
		if (StorageService.instance) {
			return StorageService.instance;
		}

		const instance = new StorageService();
		await instance.initialize();
		StorageService.instance = instance;

		return instance;
	}

	private async initialize(): Promise<void> {
		this.db = await this.openConnection();
		this.notesStore = new NotesStore(this.db);
	}

	private openConnection(): Promise<IDBDatabase> {
		return new Promise<IDBDatabase>((resolve, reject) => {
			const connection = indexedDB.open(this.name, this.version);

			connection.addEventListener("upgradeneeded", (event: IDBVersionChangeEvent) => {
				const request = event.target as IDBOpenDBRequest;
				const db = request.result;
				const transaction = request.transaction;

				if (!transaction) {
					reject(new Error("Missing upgrade transaction."));
					return;
				}

				switch (event.oldVersion) {
					case 0:
						db.createObjectStore("notes", { keyPath: "id", autoIncrement: true });
						break;
					default:
						break;
				}
			});

			connection.addEventListener(
				"success",
				() => {
					const db = connection.result;
					resolve(db);

					db.addEventListener("close", () => {
						alert("Database connection closed. Please reload the page.");
					});
					db.addEventListener("versionchange", () => {
						db.close();
						alert("Database is outdated. Please reload the page.");
					});
				},
				{ once: true },
			);

			connection.addEventListener("error", () => reject(connection.error), { once: true });
			connection.addEventListener(
				"blocked",
				() => {
					alert(
						"Database is outdated. The newer version can't be loaded until you close other tabs. Please reload the page.",
					);
				},
				{ once: true },
			);
		});
	}
}

const storage = await StorageService.create();
const noteId = await storage.notes.add<Note>({ title: "My first note" });
const note = await storage.notes.get<Note>(noteId);
console.log(note);
```

## API

Extend `BaseStore` with your object store name, then call the promise-based helpers on the subclass instance.

| Method | Description |
| --- | --- |
| `add`, `bulkAdd` | Insert new records |
| `put`, `bulkPut` | Replace or upsert full records |
| `get`, `getAll`, `count` | Read records |
| `getAllFrom`, `getAllTo`, `getAllFromTo` | Read by key range |
| `delete`, `bulkDelete`, `clear` | Remove records |
| `update` | Patch an existing record by key |
| `updateByPath` | Set a nested field on one record |
| `updateAll` | Patch every record in the store |
| `updateAllByPath` | Set a nested field on every record |
| `mapAll`, `findAllBy`, `takeByLimit`, `reduce`, `sliceBy` | Cursor-based iteration |

`put` expects a full record and upserts by key. `update` reads the current record, merges a partial patch, and returns `false` when the key is missing.

## License

MIT
