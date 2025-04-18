import { toRaw } from "vue";

import { TopNotice } from "../utils/notice";
import { recognitionFields } from "../fields/recognitions";
import { actionFields } from "../fields/actions";
import { extraFields } from "../fields/extras";
import { useNodeStore } from "../stores/nodeStore";
import { useFileStore } from "../stores/fileStore";
import settings from "../settings";

function parseNodeKey(filename, label, id) {
  return `${filename}_${label}`;
}

function parseFields(nodeData) {
  const keys = Object.keys(nodeData);
  const fields = {};

  // 识别算法
  fields["recognition"] = nodeData.recognition;
  const recognitionExtraKeys = Object.keys(
    recognitionFields[nodeData.recognition]?.extras || {}
  );
  // 执行方式
  fields["action"] = nodeData.action;
  const actionExtraKeys = Object.keys(
    actionFields[nodeData.action]?.extras || {}
  );
  // 其他
  const extraKeys = Object.keys(extraFields);
  const validKeys = [...recognitionExtraKeys, ...actionExtraKeys, ...extraKeys];

  keys.forEach((key) => {
    if (!validKeys.includes(key)) return;
    fields[key] = toRaw(nodeData[key]);
  });

  return fields;
}

// 添加边
function addEdgeFromLabels(sourceNode, edgeIds, type) {
  if (typeof edgeIds != "object") return;
  const nodeStore = useNodeStore();
  edgeIds.forEach((label) => {
    const targetLabel = label.split("_")[1];
    const targetNode = nodeStore.findNodeByLabel(targetLabel);
    const edge = {
      source: sourceNode?.id || "0",
      target: targetNode.id,
      sourceHandle:
        sourceNode?.data?.label == undefined ||
        sourceNode.data.label == "开始任务"
          ? null
          : type,
      targetHandle: "target",
    };
    nodeStore.addEdge(edge);
  });
}

// 节点转Json
function createSingleNodeObj(node, data) {
  const nodeObj = parseFields(data);
  if (nodeObj.jump_yamaape) {
    nodeObj.next = [nodeObj.jump_yamaape];
  }
  nodeObj.__yamaape = {
    position: node.position,
  };
  return nodeObj;
}

export default class Transfer {
  static getValidFields(nodeData) {
    return parseFields(nodeData);
  }

  // 节点转Json
  static nodeToJsonObj(filename) {
    const nodeStore = useNodeStore();
    const fileStore = useFileStore();
    const edges = nodeStore.edges;
    const jsonObj = {};
    jsonObj["__yamaape_config_" + filename] = {
      version: settings.version,
      export: fileStore.currentConfig?.export || "",
    };

    // 连接节点
    edges.forEach((edge) => {
      const source = edge.source;
      const target = edge.target;
      const type = edge.sourceHandle;

      // 生成节点名
      const sourceNode = nodeStore.findNode(source);
      const sourceNodeData = sourceNode?.data;
      const targetNode = nodeStore.findNode(target);
      const targetNodeData = targetNode.data;
      const sourceKey =
        sourceNodeData.label == "开始任务"
          ? filename
          : parseNodeKey(filename, sourceNodeData.label);
      const targetKey = parseNodeKey(filename, targetNodeData.label);

      // 创建节点
      if (!jsonObj[sourceKey]) {
        jsonObj[sourceKey] = createSingleNodeObj(sourceNode, sourceNodeData);
      }
      if (!jsonObj[targetKey]) {
        jsonObj[targetKey] = createSingleNodeObj(targetNode, targetNodeData);
      }

      // 连接节点
      if (!jsonObj[sourceKey][type || "next"]) {
        jsonObj[sourceKey][type || "next"] = [];
      }
      jsonObj[sourceKey][type || "next"].push(targetKey);
    });

    if (jsonObj[filename]) {
      delete jsonObj[filename].recognition;
      delete jsonObj[filename].action;
    }

    if (fileStore.currentConfig?.export) {
      Object.keys(jsonObj).forEach((key) => {
        if (key.includes("__yamaape_config")) return;
        if (!jsonObj[key]["on_error"]) {
          jsonObj[key].on_error = [];
        }
        jsonObj[key].on_error.push(fileStore.currentConfig.export);
      });
    }

    return jsonObj;
  }

  // Json转节点
  static jsonToNodes(json, isTip = true) {
    const nodeStore = useNodeStore();
    const fileStore = useFileStore();
    const backupNodes = toRaw(nodeStore.nodes);
    const backupEdges = toRaw(nodeStore.edges);
    let filename = true;
    try {
      // 格式转化
      if (typeof json != "object") {
        json = JSON.parse(json);
      }
      nodeStore.clear();
      // 提取节点
      const keys = Object.keys(json);
      keys.forEach((key) => {
        // 设置节点
        const obj = json[key];
        if (key.includes("__yamaape_config")) {
          fileStore.currentConfig.export = obj.export || "";
          return;
        }
        const label = key.split("_")[1];
        // 开始节点
        if (label == "开始任务" || label == undefined) {
          if (obj.__yamaape) {
            Object.keys(obj.__yamaape).forEach((key) => {
              nodeStore.nodes[0][key] = obj.__yamaape[key];
            });
          }
          filename = key.split("_")[0];
          return;
        }
        // 添加节点
        const node = nodeStore.addNode();
        if (obj.__yamaape) {
          Object.keys(obj.__yamaape).forEach((key) => {
            node[key] = obj.__yamaape[key];
          });
        }
        node.data.label = label;
        Object.assign(node.data, parseFields(obj));
      });
      // 添加连接
      keys.forEach((key) => {
        const obj = json[key];
        const label = key.split("_")[1];
        const node = nodeStore.findNodeByLabel(label);
        if (obj.jump_yamaape && obj.next) {
          obj.next = obj.next.filter((item) => item != obj.jump_yamaape);
        }
        addEdgeFromLabels(node, obj.next, "next");
        addEdgeFromLabels(node, obj.interrupt, "interrupt");
        if (obj.on_error?.includes(fileStore.currentConfig.export)) {
          obj.on_error = obj.on_error.filter(
            (item) => item != fileStore.currentConfig.export
          );
        }
        addEdgeFromLabels(node, obj.on_error, "on_error");
      });

      for (const key of keys) {
        if (key.includes("__yamaape_config")) {
          fileStore.currentConfig.export = "";
          break;
        }
      }

      if (isTip) {
        TopNotice.success("Json转换成功");
      }
      return filename;
    } catch (e) {
      nodeStore.nodes = backupNodes;
      nodeStore.edges = backupEdges;
      TopNotice.error("JSON格式错误");
      console.log(e);
      return false;
    }
  }
}

/*
const testJsonStr = `
{"新建文件1_开始任务":{"next":["新建文件1_新增节点1","新建文件1_新增节点2"]},"新建文件1_新增节点1":{"recognition":"OCR","action":"Click","index":0,"target":[0,0,0,0],"timeout":20000,"next":["新建文件1_新增节点3"]},"新建文件1_新增节点2":{"recognition":"DirectHit","action":"DoNothing","interrupt":["新建文件1_新增节点3"],"on_error":["新建文件1_新增节点3"]},"新建文件1_新增节点3":{"recognition":"DirectHit","action":"DoNothing"}}
`;
*/
