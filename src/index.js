// Copyright © 2017-2020 Trust Wallet.
//
// This file is part of Trust. The full Trust copyright notice, including
// terms governing use, modification, and redistribution, is contained in the
// file LICENSE at the root of the source code distribution tree.

"use strict";

import Web3 from "web3";
import RPCServer from "./rpc";
import ProviderRpcError from "./error";
import Utils from "./utils";
import IdMapping from "./id_mapping";
import { EventEmitter } from "events";
import isUtf8 from "isutf8";
import { TypedDataUtils } from "eth-sig-util";

class Web3ChannelProvider extends EventEmitter {
  constructor(config) {
    super();

    this.idMapping = new IdMapping();
    this.callbacks = new Map();
    this.wrapResults = new Map();
    this.isWeb3Channel = true;
    this.isDebug = !!config.isDebug;
    this.chainId = config.chainId;

    this.request({ method: "eth_requestAccounts", params: [] });
  }

  setAddress(address) {
    const lowerAddress = (address || "").toLowerCase();
    this.address = lowerAddress;
    this.ready = !!address;
    console.log(`setAddress: ${lowerAddress}, isReady: ${this.ready}`);
    for (var i = 0; i < window.frames.length; i++) {
      const frame = window.frames[i];
      if (frame.ethereum && frame.ethereum.isWeb3Channel) {
        frame.ethereum.address = lowerAddress;
        frame.ethereum.ready = !!address;
      }
    }
  }

  request(payload) {
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof Web3ChannelProvider)) {
      that = window.ethereum;
    }
    return that._request(payload, false);
  }

  /**
   * @deprecated Listen to "connect" event instead.
   */
  isConnected() {
    return true;
  }

  /**
   * @deprecated Use request({method: "eth_requestAccounts"}) instead.
   */
  enable() {
    console.log(
      'enable() is deprecated, please use window.ethereum.request({method: "eth_requestAccounts"}) instead.'
    );
    return this.request({ method: "eth_requestAccounts", params: [] });
  }

  /**
   * @deprecated Use request() method instead.
   */
  sendAsync(payload, callback) {
    console.log(
      "sendAsync(data, callback) is deprecated, please use window.ethereum.request(data) instead."
    );
    // this points to window in methods like web3.eth.getAccounts()
    var that = this;
    if (!(this instanceof Web3ChannelProvider)) {
      that = window.ethereum;
    }
    if (Array.isArray(payload)) {
      Promise.all(payload.map(that._request.bind(that)))
        .then((data) => callback(null, data))
        .catch((error) => callback(error, null));
    } else {
      that
        ._request(payload)
        .then((data) => callback(null, data))
        .catch((error) => callback(error, null));
    }
  }

  /**
   * @private Internal rpc handler
   */
  _request(payload, wrapResult = true) {
    this.idMapping.tryIntifyId(payload);
    if (this.isDebug) {
      console.log(`==> _request payload ${JSON.stringify(payload)}`);
    }
    return new Promise((resolve, reject) => {
      if (!payload.id) {
        payload.id = Utils.genId();
      }
      this.callbacks.set(payload.id, (error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(data);
        }
      });
      this.wrapResults.set(payload.id, wrapResult);

      switch (payload.method) {
        case "eth_accounts":
          return this.eth_accounts(payload);
        case "eth_coinbase":
          return this.eth_coinbase(payload);
        case "net_version":
          return this.net_version(payload);
        case "eth_chainId":
          return this.eth_chainId(payload);
        case "eth_sign":
          return this.eth_sign(payload);
        case "personal_sign":
          return this.personal_sign(payload);
        case "personal_ecRecover":
          return this.personal_ecRecover(payload);
        case "eth_signTypedData_v3":
          return this.eth_signTypedData(payload, false);
        case "eth_signTypedData":
        case "eth_signTypedData_v4":
          return this.eth_signTypedData(payload, true);
        case "eth_sendTransaction":
          return this.eth_sendTransaction(payload);
        case "eth_requestAccounts":
          return this.eth_requestAccounts(payload);
        case "wallet_watchAsset":
          return this.wallet_watchAsset(payload);
        case "wallet_addEthereumChain":
          return this.wallet_addEthereumChain(payload);
        case "eth_newFilter":
        case "eth_newBlockFilter":
        case "eth_newPendingTransactionFilter":
        case "eth_uninstallFilter":
        case "eth_subscribe":
          throw new ProviderRpcError(
            4200,
            `Mask does not support calling ${payload.method}. Please use your own solution`
          );
        default:
          // call upstream rpc
          this.postMessage(payload.method, payload.id, payload);
      }
    });
  }

  eth_accounts(payload) {
    this.postMessage("eth_accounts", payload.id, {});
  }

  eth_coinbase(payload) {
    this.postMessage("eth_coinbase", payload.id, {});
  }

  net_version(payload) {
    this.postMessage("net_version", payload.id);
  }

  eth_chainId(payload) {
    return "0x" + this.chainId.toString(16);
  }

  eth_sign(payload) {
    const buffer = Utils.messageToBuffer(payload.params[1]);
    const hex = Utils.bufferToHex(buffer);
    if (isUtf8(buffer)) {
      this.postMessage("signPersonalMessage", payload.id, { data: hex });
    } else {
      this.postMessage("signMessage", payload.id, { data: hex });
    }
  }

  personal_sign(payload) {
    const message = payload.params[0];
    const buffer = Utils.messageToBuffer(message);
    if (buffer.length === 0) {
      // hex it
      const hex = Utils.bufferToHex(message);
      this.postMessage("signPersonalMessage", payload.id, { data: hex });
    } else {
      this.postMessage("signPersonalMessage", payload.id, { data: message });
    }
  }

  personal_ecRecover(payload) {
    this.postMessage("ecRecover", payload.id, {
      signature: payload.params[1],
      message: payload.params[0],
    });
  }

  eth_signTypedData(payload, useV4) {
    const message = JSON.parse(payload.params[1]);
    const hash = TypedDataUtils.sign(message, useV4);
    this.postMessage("signTypedMessage", payload.id, {
      data: "0x" + hash.toString("hex"),
      raw: payload.params[1],
    });
  }

  eth_sendTransaction(payload) {
    this.postMessage("eth_signTransaction", payload.id, payload.params[0]);
  }

  eth_requestAccounts(payload) {
    this.postMessage("eth_requestAccounts", payload.id, {});
  }

  wallet_watchAsset(payload) {
    let options = payload.params.options;
    this.postMessage("watchAsset", payload.id, {
      type: payload.type,
      contract: options.address,
      symbol: options.symbol,
      decimals: options.decimals || 0,
    });
  }

  wallet_addEthereumChain(payload) {
    this.postMessage("addEthereumChain", payload.id, payload.params[0]);
  }

  /**
   * @private Internal js -> native message handler
   */
  postMessage(handler, id, data) {
    if (this.ready || handler === "eth_requestAccounts") {
      let print = this.isDebug;
      let object = {
        callbackId: id,
        action: handler,
        print: print,
        parameters: data,
      };

      window.webkit.messageHandlers.web3Channel.postMessage(object);
    } else {
      // don't forget to verify in the app
      this.sendError(id, new ProviderRpcError(4100, "provider is not ready"));
    }
  }

  /**
   * @private Internal native result -> js
   */
  sendResponse(response) {
    let id = response.id;
    let result = response.result;

    let originId = this.idMapping.tryPopId(id) || id;
    let callback = this.callbacks.get(id);
    let wrapResult = this.wrapResults.get(id);
    let data = { jsonrpc: "2.0", id: originId };
    if (typeof result === "object" && result.jsonrpc && result.result) {
      data.result = result.result;
    } else {
      data.result = result;
    }
    if (this.isDebug) {
      console.log(
        `<== sendResponse id: ${id}, result: ${JSON.stringify(
          result
        )}, data: ${JSON.stringify(data)}`
      );
    }

    if (response.method === "eth_requestAccounts") {
        this.setAddress(result[0]);
    }

    if (callback) {
      if (this.isDebug) {
          console.log(`callback excuted ${response.method}`);
      }
      wrapResult ? callback(null, data) : callback(null, result);
      this.callbacks.delete(id);
    } else {
      console.log(`callback id: ${id} not found`);
      // check if it's iframe callback
      for (var i = 0; i < window.frames.length; i++) {
        const frame = window.frames[i];
        try {
          if (frame.ethereum.callbacks.has(id)) {
            frame.ethereum.sendResponse(id, result);
          }
        } catch (error) {
          console.log(`send response to frame error: ${error}`);
        }
      }
    }
  }

  /**
   * @private Internal native error -> js
   */
  sendError(id, error) {
    console.log(`<== ${id} sendError ${error}`);
    let callback = this.callbacks.get(id);
    if (callback) {
      callback(error instanceof Error ? error : new Error(error), null);
      this.callbacks.delete(id);
    }
  }
}

window.web3Channel = {
  Provider: Web3ChannelProvider,
  Web3: Web3,
};
