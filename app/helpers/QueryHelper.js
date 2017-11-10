import StringHelper from "./StringHelper";
import UpdateService from "../service/UpdateService";
import FirebaseService from "../service/FirebaseService";
import { isValidDate, executeDateComparison } from "../helpers/DateHelper";
const NO_EQUALITY_STATEMENTS = "NO_EQUALITY_STATEMENTS";
const SELECT_STATEMENT = "SELECT_STATEMENT";
const UPDATE_STATEMENT = "UPDATE_STATEMENT";
const INSERT_STATEMENT = "INSERT_STATEMENT";
const DELETE_STATEMENT = "DELETE_STATEMENT";
const FIRESTATION_DATA_PROP = "FIRESTATION_DATA_PROP";
const EQUATION_IDENTIFIERS = [" / ", " + ", " - ", " * "];

export default class QueryHelper {
  static getRootKeysPromise(database) {
    if (!database) {
      return null;
    }
    const url =
      "https://" +
      database.config.projectId +
      ".firebaseio.com//.json?shallow=true";
    return fetch(url).then(response => {
      return response.json();
    });
  }

  static executeQuery(query, database, callback, commitResults) {
    let app = FirebaseService.startFirebaseApp(database);
    let db = app.database();
    let ref = db.ref("/");
    ref.off("value");
    const statementType = this.determineQueryType(query);
    if (statementType === SELECT_STATEMENT) {
      this.executeSelect(query, db, callback);
    } else if (statementType === UPDATE_STATEMENT) {
      return this.executeUpdate(query, db, callback, commitResults);
    } else if (statementType === DELETE_STATEMENT) {
      return this.executeDelete(query, db, callback, commitResults);
    } else if (statementType === INSERT_STATEMENT) {
      return this.executeInsert(query, db, callback, commitResults);
    }
  }

  static formatAndCleanQuery(query) {
    //called by App.jsx to remove comments before saving to history
    query = StringHelper.replaceAll(query, /(\/\/|--).+/, "");
    query = query.replace(/\r?\n|\r/g, " ");
    return query;
  }

  static executeInsert(query, db, callback, commitResults) {
    const collection = this.getCollection(query, INSERT_STATEMENT);
    const that = this;
    const insertCount = this.getInsertCount(query);
    const path = collection + "/";
    const insertObjects = this.getObjectsFromInsert(query);
    debugger;
    if (commitResults) {
      let keys = insertObjects && Object.keys(insertObjects);
      for (let i = 1; i < insertCount; i++) {
        //insert clones
        UpdateService.pushObject(db, path, insertObjects[keys[0]]);
      }
      for (let key in insertObjects) {
        UpdateService.pushObject(db, path, insertObjects[key]);
      }
    }
    let results = {
      insertCount: insertCount,
      statementType: INSERT_STATEMENT,
      payload: insertObjects,
      path: path
    };
    callback(results);
  }

  static executeDelete(query, db, callback, commitResults) {
    const collection = this.getCollection(query, DELETE_STATEMENT);
    const that = this;
    this.getWheres(query, db, wheres => {
      this.getDataForSelect(db, collection, null, wheres, null, dataToAlter => {
        if (dataToAlter && commitResults) {
          Object.keys(dataToAlter.payload).forEach(function(objKey, index) {
            const path = collection + "/" + objKey;
            UpdateService.deleteObject(db, path);
          });
        }
        let results = {
          statementType: DELETE_STATEMENT,
          payload: dataToAlter.payload,
          firebaseListener: dataToAlter.firebaseListener,
          path: collection
        };
        callback(results);
      });
    });
  }

  static executeSelect(query, db, callback) {
    const collection = this.getCollection(query, SELECT_STATEMENT);
    const orderBys = this.getOrderBys(query);
    const selectedFields = this.getSelectedFields(query);
    this.getWheres(query, db, wheres => {
      this.getDataForSelect(
        db,
        collection,
        selectedFields,
        wheres,
        orderBys,
        callback
      );
    });
  }

  static executeUpdate(query, db, callback, commitResults) {
    const collection = this.getCollection(query, UPDATE_STATEMENT);
    const sets = this.getSets(query);
    if (!sets) {
      return null;
    }
    const that = this;
    this.getWheres(query, db, wheres => {
      this.getDataForSelect(db, collection, null, wheres, null, dataToAlter => {
        let data = dataToAlter.payload;
        Object.keys(data).forEach(function(objKey, index) {
          that.updateItemWithSets(data[objKey], sets);
          const path = collection + "/" + objKey;
          if (commitResults) {
            UpdateService.updateFields(
              db,
              path,
              data[objKey],
              Object.keys(sets)
            );
          }
        });
        let results = {
          statementType: UPDATE_STATEMENT,
          payload: data,
          firebaseListener: dataToAlter.firebaseListener,
          path: collection
        };
        callback(results);
      });
    });
  }

  static getDataForSelect(
    db,
    collection,
    selectedFields,
    wheres,
    orderBys,
    callback
  ) {
    console.log(
      "getData (collection, selectedFields, wheres):",
      collection,
      selectedFields,
      wheres
    );
    var ref = db.ref(collection);
    let results = {
      queryType: SELECT_STATEMENT,
      path: collection,
      orderBys: orderBys,
      firebaseListener: ref
    };
    if (!selectedFields && !wheres) {
      ref = db.ref(collection);
      ref.on("value", snapshot => {
        results.payload = snapshot.val();
        return callback(results);
      });
    } else if (!wheres) {
      ref.on("value", snapshot => {
        results.payload = snapshot.val();
        if (selectedFields) {
          results.payload = this.removeNonSelectedFieldsFromResults(
            results.payload,
            selectedFields
          );
        }
        return callback(results);
      });
    } else {
      let mainWhere = wheres[0];
      if (mainWhere.error && mainWhere.error === NO_EQUALITY_STATEMENTS) {
        ref.on("value", snapshot => {
          results.payload = this.filterWheresAndNonSelectedFields(
            snapshot.val(),
            wheres,
            selectedFields
          );
          return callback(results);
        });
      } else {
        ref
          .orderByChild(mainWhere.field)
          .equalTo(mainWhere.value)
          .on("value", snapshot => {
            results.payload = this.filterWheresAndNonSelectedFields(
              snapshot.val(),
              wheres,
              selectedFields
            );
            console.log("select results: ", results);

            return callback(results);
          });
      }
    }
  }

  static updateItemWithSets(obj, sets) {
    const that = this;
    Object.keys(sets).forEach(function(objKey, index) {
      const thisSet = sets[objKey];
      if (
        thisSet &&
        typeof thisSet === "object" &&
        thisSet.hasOwnProperty(FIRESTATION_DATA_PROP)
      ) {
        const newVal = thisSet.FIRESTATION_DATA_PROP;
        for (let i = 0; i < EQUATION_IDENTIFIERS.length; i++) {
          if (newVal.includes(EQUATION_IDENTIFIERS[i])) {
            obj[objKey] = that.executeUpdateEquation(
              obj,
              thisSet.FIRESTATION_DATA_PROP
            );
            return;
          }
        }
        //not an equation, treat it as an individual prop
        let finalValue = obj[newVal];
        if (newVal.includes(".")) {
          let props = newVal.split(".");
          finalValue = obj[props[0]];
          for (let i = 1; i < props.length; i++) {
            finalValue = finalValue[props[i]];
          }
        }
        obj[objKey] = finalValue;
      } else {
        obj[objKey] = thisSet;
      }
    });
    return obj;
  }

  static executeUpdateEquation(existingObject, equation) {
    //replace variable names with corresponding values:
    existingObject &&
      Object.keys(existingObject).forEach(key => {
        let newValue = existingObject[key];
        if (typeof newValue !== "number") {
          newValue = '"' + newValue + '"';
        }
        equation = StringHelper.replaceAll(equation, key, newValue);
      });
    //execute
    return eval(equation);
  }

  static determineQueryType(query) {
    let q = query.trim();
    let firstTerm = q.split(" ")[0].trim().toLowerCase();
    switch (firstTerm) {
      case "select":
        return SELECT_STATEMENT;
      case "update":
        return UPDATE_STATEMENT;
      case "insert":
        return INSERT_STATEMENT;
      case "delete":
        return DELETE_STATEMENT;
      default:
        return SELECT_STATEMENT;
    }
  }

  static getWheres(query, db, callback) {
    const whereIndexStart = query.indexOf(" where ") + 1;
    if (whereIndexStart < 1) {
      return callback(null);
    }
    const orderByIndex = query.toUpperCase().indexOf("ORDER BY");
    const whereIndexEnd = orderByIndex >= 0 ? orderByIndex : query.length;
    let wheresArr = query
      .substring(whereIndexStart + 5, whereIndexEnd)
      .split(" and ");
    wheresArr[wheresArr.length - 1] = wheresArr[wheresArr.length - 1].replace(
      ";",
      ""
    );
    let wheres = [];
    wheresArr.forEach(where => {
      where = StringHelper.replaceAllIgnoreCase(where, "not like", "!like");
      let eqCompAndIndex = this.determineComparatorAndIndex(where);
      let whereObj = {
        field: StringHelper.replaceAll(
          where.substring(0, eqCompAndIndex.index).trim(),
          "\\.",
          "/"
        ),
        comparator: eqCompAndIndex.comparator
      };
      let val = StringHelper.getParsedValue(
        where
          .substring(eqCompAndIndex.index + eqCompAndIndex.comparator.length)
          .trim()
      );
      if (
        typeof val === "string" &&
        val.charAt(0) === "(" &&
        val.charAt(val.length - 1) === ")"
      ) {
        this.executeSelect(val.substring(1, val.length - 1), db, results => {
          whereObj.value = results.payload;
          wheres.push(whereObj);
          if (wheresArr.length === wheres.length) {
            return callback(this.optimizeWheres(wheres));
          }
        });
      } else {
        whereObj.value = val;
        wheres.push(whereObj);
        if (wheresArr.length === wheres.length) {
          return callback(this.optimizeWheres(wheres));
        }
      }
    });
  }

  static getSets(query) {
    const setIndexStart = query.indexOf(" set ") + 1;
    if (setIndexStart < 1) {
      return null;
    }
    const whereIndexStart = query.indexOf(" where ") + 1;
    let setsArr;
    if (whereIndexStart > 0) {
      setsArr = query.substring(setIndexStart + 3, whereIndexStart).split(", ");
    } else {
      setsArr = query.substring(setIndexStart + 3).split(", ");
      setsArr[setsArr.length - 1] = setsArr[setsArr.length - 1].replace(
        ";",
        ""
      );
    }
    let sets = {};
    setsArr.forEach(item => {
      let keyValSplit = item.split("=");
      if (keyValSplit.length === 2) {
        let key = keyValSplit[0].replace(".", "/").trim();
        sets[key] = StringHelper.getParsedValue(keyValSplit[1].trim(), true);
      }
    });
    return sets;
  }

  static getOrderBys(query) {
    let caps = query.toUpperCase();
    const ORDER_BY = "ORDER BY";
    let index = caps.indexOf(ORDER_BY);
    if (index < 0) {
      return null;
    }
    let orderByStr = query.substring(index + ORDER_BY.length);
    let split = orderByStr.split(",");
    let orderBys = split.map(orderBy => {
      let propToSort = orderBy.replace(";", "").trim();
      propToSort =
        propToSort.indexOf(" ") >= 0
          ? propToSort.substring(0, propToSort.indexOf(" "))
          : propToSort;
      let orderByObj = {
        ascending: true,
        propToSort: propToSort.trim()
      };
      if (orderBy.toUpperCase().includes("DESC")) {
        orderByObj.ascending = false;
      }
      return orderByObj;
    });
    return orderBys;
  }

  static filterWheresAndNonSelectedFields(results, wheres, selectedFields) {
    if (wheres.length > 1) {
      results = this.filterResultsByWhereStatements(results, wheres.slice(1));
    }
    if (selectedFields) {
      results = this.removeNonSelectedFieldsFromResults(
        results,
        selectedFields
      );
    }
    return results;
  }

  static getCollection(q, statementType) {
    let query = q.replace(/\(.*\)/, "").trim(); //removes nested selects
    let terms = query.split(" ");
    if (statementType === UPDATE_STATEMENT) {
      return StringHelper.replaceAll(terms[1], /\./, "/");
    } else if (statementType === SELECT_STATEMENT) {
      if (terms.length === 2 && terms[0] === "from") {
        return StringHelper.replaceAll(terms[1], ".", "/");
      } else if (terms.length === 1) {
        let collection = terms[0].replace(";", "");
        return StringHelper.replaceAll(collection, /\./, "/");
      }
      let collectionIndexStart = query.indexOf("from ") + 4;
      if (collectionIndexStart < 0) {
        throw "Error determining collection.";
      }
      if (collectionIndexStart < 5) {
        return StringHelper.replaceAll(terms[0], /\./, "/");
      }
      let trimmedCol = query.substring(collectionIndexStart).trim();
      let collectionIndexEnd = trimmedCol.match(/\ |;|$/).index;
      let collection = trimmedCol.substring(0, collectionIndexEnd);
      return StringHelper.replaceAll(collection, /\./, "/");
    } else if (statementType === INSERT_STATEMENT) {
      let collectionToInsert =
        terms[1].toUpperCase() === "INTO" ? terms[2] : terms[3];
      return StringHelper.replaceAll(collectionToInsert, /\./, "/");
    } else if (statementType === DELETE_STATEMENT) {
      let index = terms.length > 2 ? 2 : 1;
      let term = StringHelper.replaceAll(terms[index], /;/, "");
      return StringHelper.replaceAll(term, /\./, "/");
    }
    throw "Error determining collection.";
  }

  static getSelectedFields(q) {
    let query = q.trim();
    if (!query.startsWith("select ") || query.startsWith("select *")) {
      return null;
    }
    let regExp = /(.*select\s+)(.*)(\s+from.*)/;
    let froms = query.replace(regExp, "$2");
    if (froms.length === query.length) {
      return null;
    }
    let fields = froms.split(",");
    if (fields.length === 0) {
      return null;
    }
    let selectedFields = {};
    fields.map(field => {
      selectedFields[field.trim()] = true;
    });
    return selectedFields;
  }

  static getObjectsFromInsert(query) {
    let valuesStr = query.match(/(values).+\);/)[0];
    let keysStr = query.substring(query.indexOf("(") + 1, query.indexOf(")"));
    let keys = keysStr.split(",");
    let valuesStrArr = valuesStr.split("(");
    valuesStrArr.shift(); //removes "values ("
    let valuesArr = valuesStrArr.map(valueStr => {
      return valueStr.substring(0, valueStr.indexOf(")")).split(",");
    });

    if (!keys || !valuesArr) {
      throw "Badly formatted insert statement";
    }

    let insertObjects = {};
    valuesArr.forEach((values, i) => {
      let insertObject = {};
      keys.forEach((key, i) => {
        insertObject[
          StringHelper.getParsedValue(key.trim())
        ] = StringHelper.getParsedValue(values[i].trim());
      });
      insertObjects["pushId_" + i] = insertObject;
    });

    return insertObjects;
  }

  static removeNonSelectedFieldsFromResults(results, selectedFields) {
    if (!results || !selectedFields) {
      return results;
    }
    Object.keys(results).forEach(function(objKey, index) {
      if (typeof results[objKey] !== "object") {
        if (!selectedFields[objKey]) {
          delete results[objKey];
        }
      } else {
        Object.keys(results[objKey]).forEach(function(propKey, index) {
          if (!selectedFields[propKey]) {
            delete results[objKey][propKey];
          }
        });
      }
    });
    return Object.keys(results).length === 1
      ? results[Object.keys(results)[0]]
      : results;
  }

  static filterResultsByWhereStatements(results, whereStatements) {
    if (!results) {
      return null;
    }
    let returnedResults = {};
    let nonMatch = {};
    for (let i = 0; i < whereStatements.length; i++) {
      let indexOffset = 1;
      let where = whereStatements[i];
      const that = this;
      Object.keys(results).forEach(function(key, index) {
        let thisResult = results[key][where.field];
        if (!that.conditionIsTrue(thisResult, where.value, where.comparator)) {
          nonMatch[key] = results[key];
        }
      });
    }
    if (nonMatch) {
      Object.keys(results).forEach(function(key, index) {
        if (!nonMatch[key]) {
          returnedResults[key] = results[key];
        }
      });
      return returnedResults;
    } else {
      return results;
    }
  }

  static conditionIsTrue(val1, val2, comparator) {
    switch (comparator) {
      case "=":
        return this.determineEquals(val1, val2);
      case "!=":
        return !this.determineEquals(val1, val2);
      case "<=":
      case "<":
      case ">=":
      case ">":
        return this.determineGreaterOrLess(val1, val2, comparator);
      case "like":
        return this.determineStringIsLike(val1, val2);
      case "!like":
        return !this.determineStringIsLike(val1, val2);
      default:
        throw "Unrecognized comparator: " + comparator;
    }
  }

  static determineEquals(val1, val2) {
    val1 = typeof val1 == "undefined" || val1 == "null" ? null : val1;
    val2 = typeof val2 == "undefined" || val2 == "null" ? null : val2;
    return val1 === val2;
  }

  static determineGreaterOrLess(val1, val2, comparator) {
    let isNum = false;
    if (isNaN(val1) || isNaN(val2)) {
      if (isValidDate(val1) && isValidDate(val2)) {
        return executeDateComparison(val1, val2, comparator);
      }
    } else {
      isNum = true;
    }
    switch (comparator) {
      case "<=":
        return isNum ? val1 <= val2 : val1.length <= val2.length;
      case ">=":
        return isNum ? val1 >= val2 : val1.length >= val2.length;
      case ">":
        return isNum ? val1 > val2 : val1.length < val2.length;
      case "<":
        return isNum ? val1 < val2 : val1.length < val2.length;
    }
  }

  static determineStringIsLike(val1, val2) {
    //TODO: LIKE fails on reserved regex characters (., +, etc)
    let regex = StringHelper.replaceAll(val2, "%", ".*");
    regex = StringHelper.replaceAll(regex, "_", ".{1}");
    // regex= StringHelper.replaceAll(regex,'\+','\+');
    let re = new RegExp("^" + regex + "$", "g");
    return re.test(val1);
  }

  static determineComparatorAndIndex(where) {
    let notEqIndex = this.getNotEqualIndex(where);
    if (notEqIndex >= 0) {
      return { comparator: "!=", index: notEqIndex };
    }

    let greaterThanEqIndex = where.indexOf(">=");
    if (greaterThanEqIndex >= 0) {
      return { comparator: ">=", index: greaterThanEqIndex };
    }

    let greaterThanIndex = where.indexOf(">");
    if (greaterThanIndex >= 0) {
      return { comparator: ">", index: greaterThanIndex };
    }

    let lessThanEqIndex = where.indexOf("<=");
    if (lessThanEqIndex >= 0) {
      return { comparator: "<=", index: lessThanEqIndex };
    }
    let lessThanIndex = where.indexOf("<");
    if (lessThanIndex >= 0) {
      return { comparator: "<", index: lessThanIndex };
    }

    let notLikeIndex = where.toLowerCase().indexOf("!like");
    if (notLikeIndex >= 0) {
      return { comparator: "!like", index: notLikeIndex };
    }

    let likeIndex = where.toLowerCase().indexOf("like");
    if (likeIndex >= 0) {
      return { comparator: "like", index: likeIndex };
    }

    let eqIndex = where.indexOf("=");
    if (eqIndex >= 0) {
      return { comparator: "=", index: eqIndex };
    }

    throw "Unrecognized comparator in where clause: '" + where + "'.";
  }

  static getInsertCount(query) {
    debugger;
    const splitQ = query.trim().split(" ");
    if (splitQ[0].toUpperCase() === "INSERT" && parseInt(splitQ[1]) > 1) {
      return parseInt(splitQ[1]);
    }
    return 1;
  }

  static getNotEqualIndex(condition) {
    return StringHelper.regexIndexOf(condition, /!=|<>/);
  }

  static optimizeWheres(wheres) {
    //rearranges wheres so first statement is an equal, or error if no equals
    //firebase has no != method, so we'll grab whole collection, and filter on client
    const firstNotEqStatement = wheres[0];
    for (let i = 0; i < wheres.length; i++) {
      if (wheres[i].value != null && wheres[i].comparator === "=") {
        wheres[0] = wheres[i];
        wheres[i] = firstNotEqStatement;
        return wheres;
      }
    }

    wheres.unshift({ error: NO_EQUALITY_STATEMENTS });
    return wheres;
  }
}
