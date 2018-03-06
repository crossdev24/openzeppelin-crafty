const ethnet = require('./ethnet');
const view = require('./view');
const error = require('./error');

// Module storage
const app = {};

window.addEventListener('load', async () => {
  if (ethnet.init()) {
    // Nothing to do if the ethnet failed to initialize
    init();
  }
});

async function init() {
  // Get the deployed game contract
  app.crafty = await ethnet.getDeployedCrafty();
  if (typeof app.crafty === 'undefined') {
    // Nothing to do if no Crafty object was created
    return;
  }

  // Build the UI
  await buildUI();

  // Account changes trigger an inventory update
  ethnet.onAccountChange(account => {
    if (account) {
      error.clear(); // Hacky - this clears the (possible) previous no account error

      view.setAccount(account);
      updateInventory();
    } else {
      error.noEthAccount();
    }
  });

  // New blocks also trigger an inventory update
  ethnet.onNewBlock(block => {
    view.setBlock(block);
    updateInventory();
  });
}

async function buildUI() {
  // The UI is built based on the set of rules
  app.rules = await $.getJSON('rules.json');

  // Inventory
  const basicItemAmountUpdaters = view.addItemList(app.rules.basic, $('#basic-item-inv'));
  const advItemAmountUpdaters = view.addItemList(app.rules.recipes.map(rec => rec.result), $('#adv-item-inv'));

  app.itemAmountUpdaters = Object.assign({}, basicItemAmountUpdaters, advItemAmountUpdaters);

  // Actions
  view.addPendableTxButtons(app.rules.basic, getCraftyAcquire, ethnet.txUrlGen(), $('#mine-actions'));
  view.addPendableTxButtons(app.rules.recipes.map(rec => rec.result), getCraftyAcquire, ethnet.txUrlGen(), $('#craft-actions'));

  // Recipes
  view.addIngredientsList(app.rules.recipes, $('#recipes'));
}

function updateInventory() {
  // Each itemAmountUpdater holds the name of the item, and a function that
  // updates the UI when called with the amount of said item
  Object.entries(app.itemAmountUpdaters).forEach(async ([item, updater]) => {
    const amount = await getCraftyAmount(item)();
    updater(amount);
  });
}

function getCraftyAcquire(item) {
  return app.crafty[`acquire${pascalify(item)}`];
}

function getCraftyAmount(item) {
  return app.crafty[`amount${pascalify(item)}`];
}

function capitalize(str) {
  return str[0].toUpperCase() + str.slice(1);
}

function pascalify(str) {
  return str.replace('-', ' ').split(' ').reduce((accum, str) => accum.concat(capitalize(str)), '');
}
