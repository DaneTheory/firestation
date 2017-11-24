import { observable } from "mobx";
import CacheHelper from "../helpers/CacheHelper";
const FirebaseService = require("electron").remote.require(
  "./server/service/FirebaseService"
);

class Store {
  @observable databases = CacheHelper.getFromLocalStore("databases");
  databases = this.databases ? this.databases : [];
  @observable firestoreEnabled = false;
  @observable
  currentDatabase = CacheHelper.getFromLocalStore("currentDatabase");
  @observable rootKeys = null;
  @observable
  savedQueriesByDb = CacheHelper.getFromLocalStore("savedQueriesByDb");
  @observable results = null;
  @observable commitQuery = null;
  @observable modal = null;
  @observable
  queryHistoryByDb = CacheHelper.getFromLocalStore("queryHistoryByDb");
  @observable firebaseListeners = [];
  @observable firestoreListeners = [];

  //Modals
  @observable newDb = { data: null };

  //Workstation
  @observable queryHistoryIsOpen = false;
  @observable query = "";
  @observable executingQuery = false;

  //Workbook
  @observable focus = false;
  @observable selectedText = "";
  constructor() {}

  appendQuery(text) {
    const query = this.query ? this.query + "\n" + text : text;
    this.query = query;
    this.focus = true;
  }

  getQueryHistory() {
    if (!this.currentDatabase || !this.queryHistoryByDb) {
      return null;
    }
    return this.queryHistoryByDb[this.currentDatabase.url];
  }

  addQueryToHistory(query) {
    if (!this.currentDatabase) {
      return;
    }
    const dbURL = this.currentDatabase.url;
    let queryHistoryByDb = this.queryHistoryByDb ? this.queryHistoryByDb : {};
    let history =
      Object.keys(queryHistoryByDb).length > 0 && queryHistoryByDb[dbURL]
        ? queryHistoryByDb[dbURL]
        : [];
    let queryObj = { body: query.trim(), date: new Date() };
    if (history && history.length >= 15) {
      history = history.slice(0, 14);
    }
    history.unshift(queryObj);

    queryHistoryByDb[dbURL] = history;
    this.queryHistoryByDb = queryHistoryByDb;
    CacheHelper.updateLocalStore("queryHistoryByDb", queryHistoryByDb);
  }

  markQueryAsCommitted(query) {
    try {
      let history = this.queryHistoryByDb[this.currentDatabase.url];
      if (history[0].body.trim() !== query.trim()) {
        return;
      }
      history[0].committed = true;
      this.queryHistoryByDb[this.currentDatabase.url] = history;
      CacheHelper.updateLocalStore("queryHistoryByDb", this.queryHistoryByDb);
    } catch (err) {
      console.log(err);
    }
  }

  clearResults() {
    this.commitQuery = null;
    this.results = null;
  }

  addNewListener = listener => {
    this[
      this.currentDatabase.firestoreEnabled
        ? "firestoreListeners"
        : "firebaseListeners"
    ].push(listener);
  };

  killListeners = () => {
    this.firebaseListeners.forEach(ref => {
      ref && ref.off("value");
    });
    this.firestoreListeners.forEach(unsubscribe => {
      unsubscribe && unsubscribe();
    });
    this.firebaseListeners = [];
    this.firestoreListeners = [];
  };

  setCurrentDatabase(database) {
    this.currentDatabase = database;
    this.queryHistoryIsOpen = false;
    this.firestoreEnabled = database.firestoreEnabled;
    this.query = "";
    this.clearResults();
    CacheHelper.updateLocalStore("currentDatabase", database);
  }

  createNewDatabase(database) {
    let err = this.checkDbForErrors(database);
    if (err) {
      return err;
    }
    database.firestoreEnabled = false;
    let databases = this.databases;
    this.databases.push(database);
    this.currentDatabase = database;
    CacheHelper.updateLocalStore("databases", databases);
    CacheHelper.updateLocalStore("currentDatabase", database);
    let exampleQueries = this.getExampleQueries();
    exampleQueries.forEach(q => {
      this.saveQuery(q);
    });
  }

  deleteCurrentDatabase() {
    this.databases = this.databases.filter(db => {
      return (
        db.serviceKey.project_id === this.currentDatabase.serviceKey.project_id
      );
    });
    CacheHelper.updateLocalStore("databases", this.databases);
    CacheHelper.updateLocalStore("currentDatabase", null);

    this.currentDatabase = null;
  }

  updateDatabase(database) {
    let databases = this.databases.map(db => {
      if (database.serviceKey.project_id === db.serviceKey.project_id) {
        return database;
      } else {
        return db;
      }
    });
    this.databases = databases;
    this.currentDatabase = database;
    CacheHelper.updateLocalStore("currentDatabase", database);
    CacheHelper.updateLocalStore("databases", databases);
  }

  checkDbForErrors(database) {
    let databases = this.databases;
    databases = databases ? databases : [];
    for (let i = 0; i < databases.length; i++) {
      let db = databases[i];
      if (db.title === database.title) {
        return 'You already have a database with the name "' + db.title + '".';
      } else if (db.serviceKey.project_id === database.serviceKey.project_id) {
        return 'This DB already exists as "' + db.title + '"';
      }
    }
    if (!FirebaseService.databaseConfigInitializes(database)) {
      return "Something went wrong with your file. It should look something like: myDatabaseName-firebase-adminsdk-4ieef-1521f1bc13.json";
    }
    return false;
  }

  saveQuery(query) {
    const url = this.currentDatabase.url;
    let queriesByDb = CacheHelper.getFromLocalStore("savedQueriesByDb");
    queriesByDb = queriesByDb ? queriesByDb : {};
    let queriesForThisDb =
      queriesByDb && queriesByDb[url] ? queriesByDb[url] : [];
    queriesForThisDb.push(query);
    queriesByDb[url] = queriesForThisDb;
    this.savedQueriesByDb = queriesByDb;
    CacheHelper.updateLocalStore("savedQueriesByDb", queriesByDb);
  }

  deleteQuery(query) {
    const url = this.currentDatabase.url;
    let queriesByDb = CacheHelper.getFromLocalStore("savedQueriesByDb");
    queriesByDb = queriesByDb ? queriesByDb : {};
    let queriesForThisDb =
      queriesByDb && queriesByDb[url] ? queriesByDb[url] : [];
    var i = queriesForThisDb.length;
    while (i--) {
      if (queriesForThisDb[i].body === query) {
        queriesForThisDb.splice(i, 1);
      }
    }
    queriesByDb[url] = queriesForThisDb;
    this.savedQueriesByDb = queriesByDb;
    CacheHelper.updateLocalStore("savedQueriesByDb", queriesByDb);
  }

  getExampleQueries() {
    return [
      {
        title: "Example Select",
        body: "select * from users where email = 'johndoe@gmail.com';"
      },
      {
        title: "Example Update",
        body: "update users set legendaryPlayer = true where level > 100;"
      },
      {
        title: "Example Delete",
        body: "delete from users where cheater = true;"
      },
      {
        title: "Example Insert",
        body:
          "insert into users (name, level, email) values ('Joe', 99, 'joe@gmail.com');"
      }
    ];
  }
}

export default Store;
