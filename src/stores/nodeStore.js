import { defineStore } from "pinia";
import { nextTick } from "vue";
import { useVueFlow } from "@vue-flow/core";

import { useStateStore } from "./stateStore";
import { TopNotice } from "../utils/notice";
import Transfer from "../core/transfer";
import Page from "../utils/page";

function getAddPosition(nodes, currentNode, nodeCount) {
  try {
    // 获取画布偏移量
    const dom = document.getElementsByClassName(
      "vue-flow__transformationpane"
    )[0];
    const transform = dom.style.transform;
    const spacePosition = transform
      .split("translate(")[1]
      .split(") scale")[0]
      .split("px");
    const left = -Number(spacePosition[0]);
    const right = -Number(spacePosition[1].split(", ")[1]);
    const width = dom.offsetWidth;
    const height = dom.offsetHeight;

    // 无节点
    if (nodeCount == 0) {
      return {
        x: Math.round(left + width / 2),
        y: Math.round(right + height / 2),
      };
    }
    // 有选中的节点
    if (currentNode?.position) {
      const position = currentNode.position;
      return { x: position.x + 260, y: position.y };
    }
    // 放在最右侧
    let rightNodePos = nodes[0].position;
    for (let i = 1; i < nodeCount; i++) {
      if (nodes[i].position.x > rightNodePos.x) {
        rightNodePos = nodes[i].position;
      }
    }
    return { x: rightNodePos.x + 260, y: rightNodePos.y };
  } catch {
    // 无节点
    if (nodeCount == 0) {
      return { x: 0, y: 0 };
    }
    if (currentNode?.position) {
      const position = currentNode.position;
      return { x: position.x + 260, y: position.y };
    } else {
      let rightNodePos = nodes[0].position;
      for (let i = 1; i < nodeCount; i++) {
        if (nodes[i].position.x > rightNodePos.x) {
          rightNodePos = nodes[i].position;
        }
      }
      return { x: rightNodePos.x + 260, y: rightNodePos.y };
    }
  }
}

export const useNodeStore = defineStore("NodeStore", {
  state: () => ({
    nodes: [],
    nodeCounter: 1,
    edges: [],
    currentNodeId: null,
    selectedNodes: [],
  }),
  getters: {
    currentNode: (state) => {
      return state.nodes.find((node) => node.id == state.currentNodeId);
    },
    nodeCount: (state) => {
      return state.nodes.length;
    },
    edgeCount: (state) => {
      return state.edges.length;
    },
  },
  actions: {
    clear() {
      this.nodes = [];
      this.edges = [];
      this.currentNodeId = null;
    },
    /**节点操作 */
    // 获取节点
    findNodeIndex(id) {
      return this.nodes.findIndex((node) => node.id == id);
    },
    findNode(id) {
      return this.nodes.find((node) => node.id == id);
    },
    findNodeByLabel(label) {
      return this.nodes.find((node) => node.data.label == label);
    },

    // 添加节点
    addNode(
      recognition = "DirectHit",
      action = "DoNothing",
      { viewer, autoSelect, autoConnect } = {
        viewer: null,
        autoSelect: false,
        autoConnect: false,
      }
    ) {
      // 检查节点是否存在
      const id = this.nodeCounter.toString();
      const label = "新增节点" + this.nodeCounter++;
      if (this.findNode(id) || this.findNodeByLabel(label)) {
        return this.addNode();
      }
      // 创建节点
      const position = {
        ...getAddPosition(this.nodes, this.currentNode, this.nodeCount),
      };
      const node = {
        id,
        type: "template",
        data: {
          label,
          recognition,
          action,
        },
        selected: false,
        position,
      };
      this.nodes.push(node);
      // 自动连接
      if (autoConnect && this.currentNode) {
        this.addEdge({
          source: this.currentNodeId,
          target: id,
          sourceHandle:
            this.currentNode.data.label == "开始任务" ? null : "next",
          targetHandle: "target",
        });
      }
      // 自动选中
      if (autoSelect) {
        for (const n of this.nodes) {
          n.selected = false;
        }
        node.selected = true;
        this.currentNodeId = null;
        nextTick(() => {
          this.currentNodeId = id;
        });
      }
      if (viewer) {
        Page.focus({ position });
      }
      return node;
    },

    // 更新节点
    updateNode(id, data) {
      const node = this.findNode(id);
      Object.assign(node, data);
    },

    // 复制节点
    copyNode(
      id,
      config = { viewer: null, autoSelect: true, autoConnect: false }
    ) {
      const originNode = id
        ? this.findNode(id) || this.currentNode
        : this.currentNode;
      const newNode = this.addNode(
        originNode.data.recognition,
        originNode.data.action,
        config
      );
      const validFields = Transfer.getValidFields(originNode.data);
      Object.keys(validFields).forEach((key) => {
        const value = validFields[key];
        if (typeof value == "object") {
          newNode.data[key] = [...value];
        } else {
          newNode.data[key] = value;
        }
      });
    },

    // 检查节点合法性
    check() {
      const stateStore = useStateStore();
      let isError = false;

      // label不能重名
      const labelSet = new Set();
      this.nodes.forEach((node) => {
        labelSet.add(node.data.label);
      });
      if (labelSet.size < this.nodeCount) {
        TopNotice.error("节点名称不能重复");
        stateStore.transferTip = "存在重复的节点名称！";
        isError = true;
      }

      for (const node of this.nodes) {
        if (node.data.label.includes("_")) {
          TopNotice.error("节点名称不能包含下划线");
          stateStore.transferTip = "节点名称不能包含下划线！";
          isError = true;
          break;
        }
      }

      if (!isError) {
        stateStore.transferTip = "";
      }
      return true;
    },

    // 删除节点
    removeNode(node) {
      const { id } = node;
      if (id == "0") {
        TopNotice.error("开始节点不能删除，将在下次更新时还原");
        return;
      }
      const nodeIndex = this.findNodeIndex(id);
      if (nodeIndex != -1) {
        this.nodes.splice(nodeIndex, 1);
      }
    },

    /**边操作 */
    // 获取边
    findEdgeIndex(source, target, sourceHandle) {
      return this.edges.findIndex((edge) => {
        return (
          edge.source == source &&
          edge.target == target &&
          edge.sourceHandle == sourceHandle
        );
      });
    },
    findEdge(source, target, sourceHandle) {
      return this.edges.find((edge) => {
        return (
          edge.source == source &&
          edge.target == target &&
          edge.sourceHandle == sourceHandle
        );
      });
    },

    // 添加边
    addEdge(connection) {
      const { source, target, sourceHandle, targetHandle } = connection;
      // 检查是否已存在边
      if (this.findEdge(source, target, sourceHandle)) return;
      // 添加边
      this.edges.push({
        id: `${source}-${sourceHandle || "next"}-${target}`,
        source,
        target,
        sourceHandle: sourceHandle,
        targetHandle: targetHandle,
        class: (sourceHandle || "target") + "-edge",
      });
    },

    // 删除边
    removeEdge(edge) {
      const { source, target, sourceHandle } = edge;
      const edgeIndex = this.findEdgeIndex(source, target, sourceHandle);
      if (edgeIndex != -1) {
        this.edges.splice(edgeIndex, 1);
      }
    },
  },
});
