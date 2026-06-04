# tiny-idb-store

IndexedDB object-store wrapper with promise-based CRUD, bulk, cursor, range, and update helpers.

## Install

```sh
npm install tiny-idb-store
```

## Scripts

- npm run test - run the Vitest suite with fake IndexedDB.
- npm run build - emit ESM JavaScript and TypeScript declarations to dist.
- npm run check - run tests and build.

## Usage

```ts
import { BaseStore } from 'tiny-idb-store'

interface Note {
  id?: number
  title: string
}

class NotesStore extends BaseStore {
  constructor(db: IDBDatabase) {
    super(db, 'notes')
  }

  addNote(title: string): Promise<IDBValidKey> {
    return this.add<Note>({ title })
  }

  getNote(id: IDBValidKey): Promise<Note | undefined> {
    return this.get<Note>(id)
  }
}

const createSchema = (db: IDBDatabase) => {
  db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true })
}

const v1 = {
  createSchema,
}

class StorageService {
  private static instance: StorageService | null = null

  private db: IDBDatabase | null = null
  private store: NotesStore | null = null
  private readonly name = 'notes-db'
  private readonly version = 1

  private constructor() {}

  get notes(): NotesStore | null {
    return this.store
  }

  static async create(): Promise<StorageService> {
    if (StorageService.instance) {
      return StorageService.instance
    }

    const instance = new StorageService()
    await instance.initialize()
    StorageService.instance = instance

    return instance
  }

  private async initialize(): Promise<void> {
    this.db = await this.openConnection()
    this.store = new NotesStore(this.db)
  }

  private openConnection(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const connection = indexedDB.open(this.name, this.version)

      connection.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const request = event.target as IDBOpenDBRequest
        const db = request.result
        const transaction = request.transaction

        if (!transaction) {
          reject(new Error('Missing upgrade transaction.'))
          return
        }

        switch (event.oldVersion) {
          case 0:
            v1.createSchema(db)
            break
          default:
            break
        }
      }

      connection.onsuccess = function () {
        const db = connection.result
        resolve(db)

        db.onclose = function () {
          alert('Database connection closed. Please reload the page.')
        }
        db.onversionchange = function () {
          db.close()
          alert('Database is outdated. Please reload the page.')
        }
      }

      connection.onerror = function () {
        reject(connection.error)
      }
      connection.onblocked = function () {
        alert(
          "Database is outdated. The newer version can't be loaded until you close other tabs. Please reload the page.",
        )
      }
    })
  }
}

const storage = await StorageService.create()
const noteId = await storage.notes.addNote('My first note')

if (noteId !== undefined) {
  const note = await storage.notes.getNote(noteId)
  console.log(note)
}
```
