import React from 'react'
import { computed } from 'mobx'
import { observable, action } from 'mobx'
import { observer, inject } from 'mobx-react'

import Input from './Input'
import ExtendedERC20 from '../models/ExtendedERC20'
import Autocomplete from 'react-autocomplete'

import RootStore from '../store/RootStore'

import './InputTokenField.css'

@inject('store')
@observer
class InputTokenField extends React.Component {
  @observable deleting = false

  static defaultProps = {
    editing: false,
  }

  @computed get inferredToken () {
    const web3 = this.props.store.web3Context.web3
    const tokenAddress = this.props.field.$('address').values()

    if (!web3.utils.isAddress(tokenAddress)) { return null }

    return new ExtendedERC20(tokenAddress)
  }

  @action
  _remove = () => {
    this.deleting = true
    setTimeout(() => {
      this.props.field.del()
    }, 251)
  }

  render () {
    return (
      <div className={`grid-x grid-margin-x align-middle input-token-field ${this.deleting ? 'deleting' : ''}`}>
        <div className='cell small-2'>
          <img
            className='cell shrink craftable-image'
            alt='the token'
            src={this.inferredToken ? this.inferredToken.image : 'https://s2.coinmarketcap.com/static/img/coins/128x128/2165.png'}
          />
        </div>
        <div className='cell small-6'>
          {this._renderTokenSelector()}
        </div>
        <div className='cell auto'>
          <Input field={this.props.field.$('amount')} />
        </div>
        {this.props.editing &&
          <div className='cell shrink'>
            <button
              className='button inverted'
              onClick={this._remove}
            >
              remove
            </button>
          </div>
        }
      </div>
    )
  }

  _renderTokenSelector = () => {
    return (
      <div className='grid-x grid-margin-x'>
        <div className='cell auto'>
          <p>{this.inferredToken ? this.inferredToken.label : 'Token Address'}</p>
          <Autocomplete
            items={
              RootStore.domain.canonicalTokens.map(token => {
                return {id: token.address, label: token.label}
              })
            }
            shouldItemRender={(item, value) => item.label.toLowerCase().includes(value.toLowerCase())}
            getItemValue={item => item.id}
            renderItem={(item, highlighted) =>
              <div
                key={item.id}
                style={{ backgroundColor: highlighted ? '#eee' : 'transparent'}}
              >
                {item.label}
              </div>
            }
            {...this.props.field.$('address').bind()}
            onSelect={value => this.props.field.$('address').value = value}
          />
        </div>
      </div>
    )
  }
}

export default InputTokenField
