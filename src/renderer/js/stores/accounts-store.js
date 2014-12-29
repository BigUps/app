var EventEmitter = require('events').EventEmitter
var util = require('util')
var blackCoinInfo = require('coininfo')('BC')
var CoinKey = require('coinkey')
var S = require('string')
var Transaction = require('cointx').Transaction
var _ = require('lodash')
var AccountConstants = require('../constants/account-constants')
var AppDispatcher = require('../dispatcher/app-dispatcher')
var blockchain = require('../blockchain')
var txUtils = require('../blockchain/txutils')

'use strict'

var CHANGE_EVENT = 'change'

function create(name) {
  var ck = CoinKey.createRandom(blackCoinInfo.versions)

  //todo: encrypt
  window.localStorage.setItem('account:' + ck.publicAddress, JSON.stringify({
    id: 'account:' + ck.publicAddress, //not positive if React requires 'id' in stores, don't think so, but need to doublecheck
    wif: ck.privateWif,
    address: ck.publicAddress,
    name: name,
    amount: 0
  }))
}

function updateAmounts() {
  blockchain.addresses.summary(AccountStore.addresses, function(err, results) {
    if (err) return console.error(err)
    results.forEach(function(res) {
      var acc = JSON.parse(window.localStorage.getItem('account:' + res.address))
      // todo, change to ratoshis
      acc.amount = res.balance / 1e8
      window.localStorage.setItem('account:' + res.address, JSON.stringify(acc))
    })
  
    // todo, research flux async
    AccountStore.emitChange()
  })
}

function send(data) {
  // amount to send
  var amountRat = parseFloat(data.amount) * 1e8
  if (!amountRat)
    return console.error('amount to send: ' + amountRat + ' invalid')
  
  // receiver
  var receiverAddress = data.address
  if (!receiverAddress)
    return console.error('receiver address ' + receiverAddress + ' invalid')

  // tx fee
  var feeRat = 10000

  var key = new CoinKey.fromWif(data.account.wif)

  blockchain.addresses.unspents(data.account.address, function(err, unspents) {
    if (err) return console.error(err)
    
    // amount we actually have
    var walletBalance = unspents.reduce(function(amount, unspent) { 
      return unspent.value + amount
    }, 0)

    if (amountRat > (walletBalance - feeRat))
      return console.error('\n  %s  \n', 'Not enough money to send.')

    var tx = new Transaction()

    unspents.forEach(function(unspent) {
      tx.addInput(unspent.txId, unspent.vout)
    })

    tx.addOutput(txUtils.addressToOutputScript(receiverAddress), amountRat)

    // only receive change if there is actually change to receive
    if (walletBalance - amountRat - feeRat > 0)
      tx.addOutput(txUtils.addressToOutputScript(key.publicAddress), walletBalance - amountRat - feeRat)

    tx.ins.forEach(function(input, index) {
      txUtils.sign(tx, index, key)
    })

    blockchain.transactions.propagate(tx.toHex(), function(err, data) {
      if (err) return console.error(err)
      console.dir(data)
      updateAmounts()
    })
  })

}

var AccountStore = {}
_.mixin(AccountStore, EventEmitter.prototype)
EventEmitter.call({})

Object.defineProperty(AccountStore, 'accounts', {
  enumerable: true, configurable: true,
  get: function() {
    var accounts = {}
    for (var i = 0; i < window.localStorage.length; ++i) {
      var key = window.localStorage.key(i)
      if (S(key).startsWith('account:')) {
        accounts[key] = JSON.parse(window.localStorage.getItem(key))
      }
    }
    return accounts
  }
})

Object.defineProperty(AccountStore, 'addresses', {
  enumerable: true, configurable: true,
  get: function() {
    return _.pluck(AccountStore.accounts, 'address') 
  }
})

AccountStore.emitChange = function() {
  this.emit(CHANGE_EVENT)
}

AccountStore.addChangeListener = function(callback) {
  this.on(CHANGE_EVENT, callback)
}

AccountStore.removeChangeListener = function(callback) {
  this.removeListener(CHANGE_EVENT, callback)
}

AppDispatcher.register(function(payload) {
  var action = payload.action

  switch (action.actionType) {
    case AccountConstants.ACCOUNT_CREATE:
      text = action.text.trim()
      if (text !== '') create(text)
      break
    
    case AccountConstants.ACCOUNT_SEND:
      send(action.data)
      break

    case AccountConstants.ACCOUNT_UPDATE_AMOUNTS:
      updateAmounts(action.data)
      break

    default:
      return true
  }

  AccountStore.emitChange()

  return true
})

window.AccountStore = AccountStore

module.exports = AccountStore
