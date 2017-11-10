import React, { Component } from "react";
import AceEditor from "react-ace";
import brace from "brace";
import "brace/mode/sql";
import "brace/theme/github";
import "brace/ext/language_tools";

export default class Workbook extends Component {
  componentWillReceiveProps(nextProps) {
    // const langTools = ace.acequire('ace/ext/language_tools');
    // const terms = ["SELECT", "UPDATE", "INSERT", "WHERE", "select"];
    // var customCompleter = {
    //   getCompletions: function (editor, session, pos, prefix, callback) {
    //     if (prefix.length === 0) { callback(null, []); return }
    //     callback(null, terms.map(term => {
    //       return { name: term, value: term, score: 300, meta: "rhyme" }
    //     }))
    //   }
    // }
    // langTools.addCompleter(customCompleter);
  }

  componentDidUpdate() {
    //query inserted, move to end of workbook
    if (this.props.store && this.props.store.focus && this.refs.code) {
      this.refs.code.editor.focus();
      this.refs.code.editor.navigateFileEnd();
      this.props.store.focus = false;
    }
  }

  render() {
    const { execute, query, defaultValue, listenForCtrlEnter } = this.props;

    const store = this.props.store;
    if (!store) {
      return <span />;
    }

    let commands = [
      {
        name: "execute",
        exec: execute,
        bindKey: { mac: "cmd-enter", win: "ctrl-enter" }
      }
    ];

    let selectedTextChange = (newValue, e) => {
      store.selectedText = this.refs.code.editor.getSelectedText();
    };

    return (
      // add props enableBasicAutocompletion, enableLiveAutocompletion
      // to re-enable autocomplete
      <div className="Workbook" id="workbook-query">
        <AceEditor
          className="AceEditor"
          mode="sql"
          theme="github"
          height="25vh"
          width="100%"
          fontSize={14}
          ref="code"
          onKeyDown={listenForCtrlEnter}
          onChange={e => {
            store.query = e;
          }}
          defaultValue={defaultValue}
          value={store.query}
          name="UNIQUE_ID_OF_DIV"
          commands={commands}
          editorProps={{ $blockScrolling: true }}
          onSelectionChange={selectedTextChange}
        />
      </div>
    );
  }
}
