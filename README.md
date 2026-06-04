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
}

class StorageService {
  private static instance: StorageService | null = null

  private db: IDBDatabase | null = null
  private notesStore: NotesStore | null = null
  private readonly name = 'notes-db'
  private readonly version = 1

  private constructor() {}

  get notes(): NotesStore {
    if (!this.notesStore) {
      throw new Error('StorageService is not initialized.')
    }

    return this.notesStore
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
    this.notesStore = new NotesStore(this.db)
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
            db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true })
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
const noteId = await storage.notes.add<Note>({ title: 'My first note' })
const note = await storage.notes.get<Note>(noteId)
console.log(note)
```
