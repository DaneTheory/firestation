import React, { Component } from "react";
import { inject, observer } from "mobx-react";
import "../assets/stylesheets/base.scss";
const FirebaseService = require("electron").remote.require(
  "./server/service/FirebaseService"
);
import QueryHelper from "../helpers/QueryHelper";
import Workstation from "./Workstation";
import Navbar from "./Navbar";
import Modal from "./modals/Modal";

@observer
export default class App extends Component {
  componentWillMount() {
    this.setCurrentDb(this.props.store.currentDatabase);
  }

  setCurrentDb = currentDatabase => {
    if (!currentDatabase) {
      return;
    }
    this.props.store.killListeners();
    FirebaseService.startFirebaseApp(currentDatabase);
    this.props.store.setCurrentDatabase(currentDatabase);
    // QueryHelper.getRootKeysPromise(currentDatabase).then(rootKeys => {
    //   console.log(rootKeys)
    //   this.props.store.rootKeys = rootKeys;
    // })
  };

  updateSavedQueries = db => {
    const dbUrl = db.config.databaseURL;
    let queriesByDb = this.props.store.savedQueriesByDb;
    let savedQueries =
      !queriesByDb || !queriesByDb[url] ? null : queriesByDb[url];
    this.setState({ savedQueries });
  };

  createDb = database => {
    let err = this.props.store.createNewDatabase(database);
    if (err) {
      return err;
    }
    this.setCurrentDb(database);
    this.props.store.currentDatabase = database;
    this.props.store.modal = null;
  };

  startFirebaseForDb = db => {
    FirebaseService.startFirebaseApp(db.url);
  };

  executeQuery = query => {
    this.props.store.killListeners();
    query = QueryHelper.formatAndCleanQuery(query);
    this.props.store.addQueryToHistory(query);
    this.props.store.executingQuery = true;
    try {
      QueryHelper.executeQuery(
        query,
        this.props.store.currentDatabase,
        results => {
          this.props.store.addNewListener(results.firebaseListener);
          this.props.store.executingQuery = false;
          this.props.store.results = null; //updating object props alone won't work w/mobx objects, need to reset to trigger observables
          this.props.store.results = results;   
          if (results && results.statementType != "SELECT_STATEMENT") {
            this.props.store.commitQuery = query;
          }
        }
      );
    } catch (error) {
      this.props.store.results = { error };
      this.props.store.executingQuery = false;
    }
  };

  commit = () => {
    this.props.store.focus = true; //refocus text after commit click
    this.props.store.killListeners();
    if (!this.props.store.commitQuery || !this.props.store.currentDatabase) {
      return;
    }
    const query = QueryHelper.formatAndCleanQuery(this.props.store.commitQuery);
    this.props.store.markQueryAsCommitted(query);
    try {
      QueryHelper.executeQuery(
        query,
        this.props.store.currentDatabase,
        results => {
          this.props.store.addNewListener(results.firebaseListener);
          this.props.store.killListeners();
          this.props.store.clearResults();
        },
        true
      );
    } catch (error) {
      debugger;
      console.log(error);
      this.props.store.results = { error };
    }
  };

  cancelCommit = () => {
    this.props.store.clearResults();
  };

  render() {
    console.log("store:", this.props.store);
    const savedQueries =
      this.props.store.savedQueriesByDb && this.props.store.currentDatabase
        ? this.props.store.savedQueriesByDb[
            this.props.store.currentDatabase.url
          ]
        : null;

    const props = {
      cancelCommit: this.cancelCommit,
      createDb: this.createDb,
      commit: this.commit,
      executeQuery: this.executeQuery,
      results: this.props.store.results,
      newDb: this.props.store.newDb,
      savedQueries: savedQueries,
      setCurrentDb: this.setCurrentDb,
      startFirebaseForDb: this.startFirebaseForDb,
      store: this.props.store,
      firestoreEnabled: this.props.store.firestoreEnabled,
      updateSavedQueries: this.updateSavedQueries
    };

    return (
      <div className="App">
        <Navbar {...props} />
        {this.props.store.modal && <Modal {...props} />}
        <Workstation {...props} />
      </div>
    );
  }
}