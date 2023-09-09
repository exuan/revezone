import { openDB, DBSchema, IDBPDatabase, IDBPObjectStore } from 'idb';
import { nanoid } from 'nanoid';
import { RevezoneFile, RevezoneFolder, RevezoneFileType, RevezoneFileTree } from '../types/file';
import { submitUserEvent } from '../utils/statistics';
import { menuIndexeddbStorage } from './_menuIndexeddb';
import { blocksuiteStorage } from './blocksuite';
import { boardIndexeddbStorage } from './boardIndexeddb';
import { DEFAULT_FILE_TREE } from '@renderer/utils/constant';
import dayjs from 'dayjs';

export interface RevezoneDBSchema extends DBSchema {
  file_tree: {
    key: string;
    value: RevezoneFileTree;
  };
}

export const INDEXEDDB_REVEZONE_FILE_TREE_STORAGE = 'revezone_file_tree';
export const INDEXEDDB_FILE_TREE = 'file_tree';

class FileTreeIndexeddbStorage {
  constructor() {
    if (FileTreeIndexeddbStorage.instance) {
      return FileTreeIndexeddbStorage.instance;
    }

    FileTreeIndexeddbStorage.instance = this;

    (async () => {
      this.db = await this.initDB();
    })();
  }

  static instance: FileTreeIndexeddbStorage;
  static oldDBSynced = false;

  db: IDBPDatabase<RevezoneDBSchema> | undefined;

  async initDB(): Promise<IDBPDatabase<RevezoneDBSchema>> {
    if (this.db) {
      return this.db;
    }

    const db = await openDB<RevezoneDBSchema>(INDEXEDDB_REVEZONE_FILE_TREE_STORAGE, 1, {
      upgrade: async (db) => {
        await this.initFileTreeStore(db);
      }
    });

    this.db = db;

    return db;
  }

  async initFileTreeStore(
    db: IDBPDatabase<RevezoneDBSchema>
  ): Promise<
    IDBPObjectStore<RevezoneDBSchema, ArrayLike<'file_tree'>, 'file_tree', 'versionchange'>
  > {
    const fileTreeStore = await db.createObjectStore(INDEXEDDB_FILE_TREE, {
      autoIncrement: true
    });

    await this.syncFromOldMenuIndexedDB();

    const fileTree = await this.getFileTree();

    console.log('--- initFileTreeStore ---', fileTree);

    if (!fileTree) {
      await this.updateFileTree(DEFAULT_FILE_TREE);
    }

    return fileTreeStore;
  }

  async addFolder(name?: string, parentId?: string) {
    await this.initDB();

    const id = `folder_${nanoid()}`;

    console.log('--- addFolder ---', name, parentId);

    const folderInfo = {
      id,
      name: name || 'New Folder',
      gmtCreate: dayjs().toLocaleString(),
      gmtModified: dayjs().toLocaleString()
    };

    await this.addFileTreeItem(folderInfo, true, parentId);

    submitUserEvent('create_folder', folderInfo);

    return folderInfo;
  }

  /**
   * TODO: Add identify name control
   * @param info
   * @param isFolder
   * @param parentId
   * @returns
   */
  async addFileTreeItem(info: RevezoneFile | RevezoneFolder, isFolder: boolean, parentId?: string) {
    await this.initDB();

    const fileTree = (await this.getFileTree()) || {};

    info.name = this.getUniqueNameInSameTreeLevel(info, fileTree, parentId);

    fileTree[info.id] = { index: info.id, isFolder, data: info, canRename: true };

    if (parentId) {
      const children = fileTree[parentId].children || [];
      fileTree[parentId].children = [info.id, ...children];
    } else {
      const children = fileTree.root.children || [];
      fileTree.root.children = [info.id, ...children];
    }

    await this.updateFileTree(fileTree);

    return info;
  }

  getUniqueNameInSameTreeLevel(
    item: RevezoneFile | RevezoneFolder,
    fileTree: RevezoneFileTree,
    parentId = 'root'
  ) {
    const parent = fileTree[parentId];
    const itemNamesInSameTreeLevel = parent.children
      ?.filter((id) => id !== item.id)
      ?.map((id) => fileTree[id].data.name);

    const isRepeated = !!itemNamesInSameTreeLevel?.find((name) => name === item.name);

    let maxRepeatIndex = 0;

    const repeatIndexRegx = new RegExp(`^${item.name}\\(([1-9]+)\\)$`);

    if (isRepeated) {
      itemNamesInSameTreeLevel?.forEach((name) => {
        const repeatIndex = name.match(repeatIndexRegx)?.[1];
        if (repeatIndex) {
          maxRepeatIndex =
            maxRepeatIndex > Number(repeatIndex) ? maxRepeatIndex : Number(repeatIndex);
        }
      });
      return `${item.name}(${maxRepeatIndex + 1})`;
    }

    return item.name;
  }

  async addFile(
    name?: string,
    type: RevezoneFileType = 'note',
    parentId?: string
  ): Promise<RevezoneFile> {
    await this.initDB();

    const fileId = `file_${nanoid()}`;

    if (type === 'note') {
      await blocksuiteStorage.addPage(fileId);
    } else if (type === 'board') {
      await boardIndexeddbStorage.addBoard(fileId, '{}');
    }

    const fileInfo = {
      id: fileId,
      name: name || '',
      type,
      gmtCreate: dayjs().toLocaleString(),
      gmtModified: dayjs().toLocaleString()
    };

    await this.addFileTreeItem(fileInfo, false, parentId);

    submitUserEvent(`create_${type}`, fileInfo);

    return fileInfo;
  }

  async updateFileTree(fileTree: RevezoneFileTree) {
    await this.initDB();

    await this.db?.put(INDEXEDDB_FILE_TREE, fileTree, INDEXEDDB_FILE_TREE);

    return fileTree;
  }

  // // TODO: NOT FINISHED, DO NOT USE
  // async _copyFile(copyFileId: string, folderId: string) {
  //   await this.initDB();

  //   if (!(copyFileId && folderId)) return;

  //   const copyFile = await this.db?.get(INDEXEDDB_FILE, copyFileId);

  //   await this.addFile(folderId, copyFile?.type);

  //   // await blocksuiteStorage.copyPage();
  // }

  async getFile(fileId: string): Promise<RevezoneFile | undefined> {
    await this.initDB();

    const fileTree: RevezoneFileTree | undefined = (await this.db?.get(
      INDEXEDDB_FILE_TREE,
      INDEXEDDB_FILE_TREE
    )) as RevezoneFileTree | undefined;
    return fileTree?.[fileId]?.data as RevezoneFile;
  }

  async deleteFile(fileId: string) {
    await this.initDB();

    await this.deleteItemFromFileTree(fileId);

    submitUserEvent(`delete_file`, { fileId });
  }

  async deleteItemFromFileTree(id: string): Promise<RevezoneFileTree> {
    await this.initDB();

    const newTree: RevezoneFileTree = {};

    const tree: RevezoneFileTree | undefined = await this.getFileTree();

    if (tree) {
      const clonedItem = JSON.parse(JSON.stringify(tree[id].data));
      const clonedTree = JSON.parse(JSON.stringify(tree));
      setTimeout(() => {
        window.api.deleteFileOrFolder(clonedItem, clonedTree);
      }, 2000);

      Object.entries(tree).forEach(([key, item]) => {
        if (key !== id) {
          item.children = item.children?.filter((_key) => _key !== id);
          newTree[key] = item;
        }
      });
    }

    await this.updateFileTree(newTree);

    return newTree;
  }

  async syncFromOldMenuIndexedDB() {
    await this.initDB();

    const oldFileTree = await menuIndexeddbStorage.getFileTreeFromOlderData();

    this.transferDataFromMenuIndexedDB(oldFileTree);

    return oldFileTree;
  }

  async transferDataFromMenuIndexedDB(oldFileTree: RevezoneFileTree) {
    if (FileTreeIndexeddbStorage.oldDBSynced) return;

    FileTreeIndexeddbStorage.oldDBSynced = true;

    this.updateFileTree(oldFileTree);
  }

  async getFileTree(): Promise<RevezoneFileTree | undefined> {
    await this.initDB();

    const fileTree = await this.db?.get(INDEXEDDB_FILE_TREE, INDEXEDDB_FILE_TREE);

    // DEBUG
    // @ts-ignore
    window.fileTree = fileTree;

    return fileTree;
  }

  async updateFileGmtModified(file: RevezoneFile) {
    await this.initDB();

    const fileTree = await this.getFileTree();

    if (!fileTree) return;

    fileTree[file.id].data.gmtModified = dayjs().toLocaleString();

    await this.updateFileTree(fileTree);
  }

  async updateFileOrFolderName(item: RevezoneFolder | RevezoneFile, name: string) {
    await this.initDB();

    if (name === item?.name) return;

    const fileTree = await this.getFileTree();

    if (!fileTree) return;

    setTimeout(() => {
      window.api.deleteFileOrFolder(item, fileTree);
    }, 2000);

    let parentId;

    Object.values(fileTree).forEach((treeItem) => {
      if (treeItem.children?.includes(item.id)) {
        parentId = treeItem.data.id;
      }
    });

    const uniqueName = this.getUniqueNameInSameTreeLevel({ ...item, name }, fileTree, parentId);

    fileTree[item.id].data.name = uniqueName;

    await this.updateFileTree(fileTree);

    console.log('--- rename ---', item.id, uniqueName, fileTree, window.api);

    // await window.api?.renameFileOrFolder();
  }

  async deleteFolder(folderId: string) {
    if (!folderId) return;

    await this.initDB();

    console.log('--- delete folder ---', folderId);

    await this.deleteItemFromFileTree(folderId);

    submitUserEvent('delete_folder', { folderId });
  }
}

export const fileTreeIndexeddbStorage = new FileTreeIndexeddbStorage();
