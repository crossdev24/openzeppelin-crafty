import React from 'react'
import { observable, computed, when, reaction, runInAction } from 'mobx'
import { observer, inject } from 'mobx-react'
import { asyncComputed } from '../util'
import keyBy from 'lodash/keyBy'
import BN from 'bn.js'

import Header from '../components/Header'
import Footer from '../components/Footer'
import WithWeb3Context from '../components/WithWeb3Context'
import EmptyState from '../components/EmptyState'
import SectionLoader from '../components/SectionLoader'

import craftableTokenWithStore from '../models/CraftableToken'

import craftCraftableForm from '../forms/CraftCraftable'
import CraftingIngredientRow from '../components/CraftingIngredientRow'

@inject('store')
@observer
class CraftableTokenPage extends React.Component {
  @observable form = null
  @observable weAreChangingItSoChill = true
  @observable expectingChange = new Map()
  @observable deploying = false

  constructor (props) {
    super(props)

    this._lazyLoadForm()
  }

  componentWillUnmount () {
    this.stopSyncingApprovals && this.stopSyncingApprovals()
  }

  _syncApprovalsToForm = async () => {
    this.stopSyncingApprovals = reaction(
      () => this.approvalsInfo,
      () => {
        runInAction(() => (this.weAreChangingItSoChill = true))
        this.approvalsInfo.forEach((ai, i) => {
          const field = this.form
            .$(`approvals.${i}`)
          field
            .$('approved')
            .set(ai.approved)
          field
            .$('pending')
            .set(ai.busy)
        })
        runInAction(() => (this.weAreChangingItSoChill = false))
      },
      { fireImmediately: true }
    )

    this.approvalsInfo.forEach((ai, i) => {
      const field = this.form.$(`approvals.${i}`)
      field
        .$('approved')
        .intercept({
          key: 'value',
          call: ({ change }) => {
            if (this.weAreChangingItSoChill) {
              if (change.oldValue !== change.newValue) {
                // we changed it!
                runInAction(() => {
                  this.expectingChange.set(field.$('address').values(), false)
                })
              }

              // allow it to happen
              return change
            }

            // @TODO(shrugs) - allow disables
            if (!change.newValue) {
              return null
            }

            // we aren't changing it, so the user is!
            try {
              // set pending
              field.$('pending').set(true)

              // async ask the user to send the transaction
              this.requestApprovalChange(
                field,
                change
              )

              // @TODO - return change
              return null
            } catch (error) {
              field.$('approved').set(change.oldValue)
              return null
            } finally {
              field.$('pending').set(false)
            }
          },
        })
    })
  }

  requestApprovalChange = async (field, change) => {
    const address = field.$('address').values()
    const token = this.ingredientsByAddress[address]
    try {
      await token.approve(
        this.props.store.domain.crafty.address,
        new BN(change.newValue
          ? 100
          : 0
        ), // @TODO - amount or maxint
      )
      runInAction(() => {
        this.expectingChange.set(address, true)
      })
      // set local pending
    } catch (error) {
      runInAction(() => {
        this.expectingChange.set(address, false)
      })
      // cancel local pending
      console.error(error)
    }
  }

  _lazyLoadForm = async () => {
    await when(() => this.token)

    // we have token, so let's render its ingredients
    await when(() => this.token.ingredientsAndAmounts)

    // now we have ingredients so let's create the form with defaults
    runInAction(() => {
      this.form = craftCraftableForm({
        values: {
          approvals: this.token.ingredientsAndAmounts.map(i => ({
            address: i.token.address,
            amount: i.amount,
            pending: true,
            approved: true,
          })),
        },
      })
    })

    // check that crafty is up before checking approvals against it
    await when(() => this.props.store.domain.crafty)

    // load all of the approvals first
    await when(() => !this.isLoadingAnyApprovals)

    // now sync them to the form
    this._syncApprovalsToForm()
  }

  pendingBalanceFor (address) {
    if (!this.token) { return null }
    if (!this.props.store.web3Context.canRead) { return null }
    if (!this.props.store.web3Context.currentAddress) { return null }

    return this.token.balanceOf(address)
  }

  @computed get myBalance () {
    const pendingBalance = this.pendingBalanceFor(this.props.store.web3Context.currentAddress)
    if (!pendingBalance) { return null }

    // @TODO(shrugs) - I can't check busy here, because it causes
    // a loop ??
    // if (this.myPendingBalance.busy()) {
    //   console.log('busy')
    //   return `... ${this.token.shortSymbol}`
    // }
    const balance = pendingBalance.current()

    return (<div><h6 className='token-symbol'>{this.token.symbol.current()}</h6><h5 className='balance'>YOUR BALANCE: {this.token.valueFormatter(balance)}</h5></div>)
  }

  @computed get ingredientsByAddress () {
    return keyBy(
      this.token.ingredientsAndAmounts.map(ia => ia.token),
      (t) => t.address
    )
  }

  @computed get amountsByAddress () {
    return keyBy(
      this.token.ingredientAddressesAndAmounts.current(),
      (ia) => ia.address,
    )
  }

  @computed get approvalsInfo () {
    return this.allowances.current().map(a => ({
      busy: a.allowance.busy() || !!this.expectingChange.get(a.address),
      approved: a.allowance.current().gt(new BN(0)),
    }))
  }

  allowances = asyncComputed([], async () => {
    if (!this.token) { return [] }

    return this.token.ingredientsAndAmounts.map(i => ({
      allowance: i.token.allowance({
        owner: this.props.store.web3Context.currentAddress,
        spender: this.props.store.domain.crafty.address,
      }),
      address: i.token.address,
    }))
  })

  @computed get token () {
    if (this._token) { return this._token }
    const address = this.props.match.params.address
    const web3 = this.props.store.web3Context.web3

    if (!web3) { return null }
    if (!web3.utils.isAddress(address)) { return null }

    const CraftableToken = craftableTokenWithStore(this.props.store)
    this._token = new CraftableToken(address)

    return this._token
  }

  @computed get isLoadingAnyApprovals () {
    return this.approvalsInfo.some(ai => ai.busy)
  }

  @computed get allApproved () {
    return this.approvalsInfo.every(ai => !ai.approved)
  }

  @computed get allGoodInTheHood () {
    return !this.isLoadingAnyApprovals && this.allApproved
  }

  displayInfoForIngredient (address) {
    const token = this.ingredientsByAddress[address]
    const amount = this.amountsByAddress[address].amount

    const balance = token
      .balanceOf(this.props.store.web3Context.currentAddress)
      .current()

    const image = token.image

    return { token, amount, balance, image }
  }

  doTheCraft = async () => {
    if (!this.allGoodInTheHood) { return }
    this.deploying = true

    try {
      const crafty = this.props.store.domain.crafty
      const craftableTokenAddress = this.token.address

      await crafty.craft(
        craftableTokenAddress
      )

      // notify the user that it was crafted or whatever
    } catch (error) {
      console.error(error)
    } finally {
      runInAction(() => {
        this.deploying = false
      })
    }
  }

  _approvalText = () => {
    return this.allApproved
      ? 'You\'ve approved all of the relevant token contracts, nice!'
      : 'You must approve the Crafting Game to spend tokens from your balance.'
  }

  render () {
    return (
      <div className="craftable-token-page">
        <Header/>
        {!this.token &&
          <div className='grid-container'>
            <div className='grid-x grid-margin-x'>
              <div className='cell auto'>
                <EmptyState />
              </div>
            </div>
          </div>
        }

        <WithWeb3Context read render={() => (
          <div className='token-container'>
            <div className='grid-x grid-margin-x relative'>
              <div key='img' className='craftable-image cell small-12 medium-shrink'>
                <img
                  src={this.token.image}
                  alt='the token'
                />
              </div>
              <div key='text' className='token-info-container'>
                <div>
                  <h3>{this.token.name.current()}</h3>
                  <p className='description'>{this.token.description}</p>
                </div>
                {this.myBalance &&
                  <div>
                    {this.myBalance}
                  </div>
                }
              </div>
              <div key='content' className='cell'>
              </div>
            </div>

          </div>
        )} />
        <div className='grey-background'>
          <div className='grid-container medium'>
            <h2>{this.token ? 'Recipe' : 'Loading...'}</h2>
          </div>
        </div>

        <WithWeb3Context read write render={() => (
          <div className='recipe-background'>
            <SectionLoader
              loading={!this.form}
              render={() =>
                <div>
                  <div className='grid-container'>
                    <div className='grid-x grid-margin-x space-between'>
                      {this.form.$('approvals').map(f =>
                        <div key={f.id} className='small-12 medium-6 large-4'>
                          <CraftingIngredientRow
                            {...this.displayInfoForIngredient(f.$('address').values())}
                            field={f}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              } />
          </div>
        )} />
        <div className='grid-container medium'>
          <h2>{ this.token ? 'Craft ' + this.token.shortName : 'Loading...'}</h2>
        </div>

        <WithWeb3Context read write render={() => (
          <SectionLoader
            loading={!this.form}
            render={() =>
              <div>
                <p className='craft-text'>{this._approvalText()}</p>
                <div>
                  <div className='craft-row'>
                    {this.allGoodInTheHood &&
                      <button
                        className='btn'
                        onClick={this.doTheCraft}
                      >
                        Craft {this.token.shortName}
                      </button>
                    }
                  </div>
                </div>
              </div>
            }
          />
        )} />

        <Footer />
      </div>
    )
  }
}

export default CraftableTokenPage