const _ = require('underscore');
const BigNumber = web3.BigNumber;
const expectPromiseThrow = require('./helpers/expectPromiseThrow');

require('chai')
  .use(require('chai-bignumber')(BigNumber))
  .use(require('chai-as-promised'))
  .should();

const Crafty = artifacts.require('Crafty');
const CraftableToken = artifacts.require('CraftableToken');

contract('Crafty', accounts => {
  let crafty = null;
  const deployer = accounts[0];
  const player = accounts[1];
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  async function getCraftableFromAddTX(tx) {
    const receipt = await tx;

    assert.equal(receipt.logs.length, 1);
    assert.equal(receipt.logs[0].event, 'CraftableAdded');

    return CraftableToken.at(receipt.logs[0].args.addr);
  }

  beforeEach(async () => {
    crafty = await Crafty.new({from: deployer});
  });

  describe('Crafting', () => {
    it('no default craftables exist', async () => {
      const totalCraftables = await crafty.getTotalCraftables();
      assert.equal(totalCraftables, 0);
    });

    it('craftables can be added by players', async () => {
      await crafty.addCraftable([], [], {from: player});

      const totalCraftables = await crafty.getTotalCraftables();
      assert.equal(totalCraftables, 1);
    });

    it('players can always craft ingredient-less craftables', async () => {
      const craftable = await getCraftableFromAddTX(crafty.addCraftable([], []));

      const initialBalance = await craftable.balanceOf(player);
      assert(initialBalance.eq(0));

      await crafty.craft(craftable.address, {from: player});

      const finalBalance = await craftable.balanceOf(player);
      assert(finalBalance.eq(1));
    });

    it('players cannot craft using ingredients without calling approve', async () => {
      const ingredient = await getCraftableFromAddTX(crafty.addCraftable([], []));
      await crafty.craft(ingredient.address, {from: player});

      const ingredientBalance = await ingredient.balanceOf(player);
      assert(ingredientBalance.eq(1));

      const craftable = await getCraftableFromAddTX(crafty.addCraftable([ingredient.address], [1]));

      // craftable requires just one ingredient, so the crafting requirement has been met.
      // However since ingredient has not been approved for crafty to use as an ingredient,
      // the craft call will fail.
      expectPromiseThrow(crafty.craft(craftable.address, {from: player}));
    });

    it('players can craft using ingredients if approve is called', async () => {
      // First, build a craftable that requires two ingredients
      const ingredients = await Promise.all([
        getCraftableFromAddTX(crafty.addCraftable([], [])),
        getCraftableFromAddTX(crafty.addCraftable([], []))
      ]);
      const ingredientAmounts = [2, 3];
      assert.equal(ingredients.length, ingredientAmounts.length);

      // Craft all ingredients
      await Promise.all(_.range(ingredients.length).map(i =>
        Promise.all(_.times(ingredientAmounts[i], () =>
          crafty.craft(ingredients[i].address, {from: player})
        ))
      ));

      // Check the balance of the ingredients has been updated
      await Promise.all(_.range(ingredients.length).map(async i => {
        const balance = await ingredients[i].balanceOf(player);
        assert(balance.eq(ingredientAmounts[i]));
      }));

      // Approve each token to be used by the game
      await Promise.all(ingredients.map(ingredient =>
        ingredient.approve(crafty.address, 100, {from: player})
      ));

      const craftable = await getCraftableFromAddTX(crafty.addCraftable(ingredients.map(ingredient => ingredient.address), ingredientAmounts));
      await crafty.craft(craftable.address, {from: player});

      const craftableBalance = await craftable.balanceOf(player);
      assert(craftableBalance.eq(1));

      // Check the ingredients were consumed
      await Promise.all(_.range(ingredients.length).map(async i => {
        const balance = await ingredients[i].balanceOf(player);
        assert(balance.eq(0));
      }));
    });
  });

  describe('RBAC', () => {
    let adminRolename = '';

    before(async () => {
      adminRolename = await crafty.ROLE_ADMIN();
    });

    it('deployer is admin', async () => {
      await crafty.hasRole(deployer, adminRolename).should.eventually.be.true;
    });

    it('admins can appoint new admins', async () => {
      await crafty.hasRole(player, adminRolename).should.eventually.be.false;

      await crafty.addAdminRole(player, {from: deployer});

      await crafty.hasRole(player, adminRolename).should.eventually.be.true;
    });

    it('non-admins cannot appoint new admins', async () => {
      expectPromiseThrow(crafty.addAdminRole(player, {from: player}));
    });

    it('admins can delete craftables', async () => {
      const craftable = await getCraftableFromAddTX(crafty.addCraftable([], []));

      // The craftable will be stored at index 0 (because it is the first craftable)
      await crafty.getTotalCraftables().should.eventually.be.bignumber.equal(1);
      await crafty.getCraftable(0).should.eventually.equal(craftable.address);

      await crafty.deleteCraftable(craftable.address, {from: deployer});

      // The craftable itself is not deleted, but its entry is zeroed-out in the game's storage
      await crafty.getTotalCraftables().should.eventually.be.bignumber.equal(1);
      await crafty.getCraftable(0).should.eventually.equal(ZERO_ADDRESS);
    });

    it('non-admins cannnot delete craftables', async () => {
      const craftable = await getCraftableFromAddTX(crafty.addCraftable([], []));
      expectPromiseThrow(crafty.deleteCraftable(craftable.address, {from: player}));
    });
  });
});
