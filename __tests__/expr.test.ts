import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalExpr, isExpression } from '../src/utils';

test('sums typed in number boxes', () => {
  assert.equal(evalExpr('2000+1500-200'), 3300);
  assert.equal(evalExpr('12*500'), 6000);
  assert.equal(evalExpr('12×500'), 6000);
  assert.equal(evalExpr('100/4'), 25);
  assert.equal(evalExpr('100÷4'), 25);
  assert.equal(evalExpr('2+3*4'), 14);
  assert.equal(evalExpr('(2+3)*4'), 20);
  assert.equal(evalExpr('1,000+500'), 1500);
  assert.equal(evalExpr('-50+20'), -30);
  assert.equal(evalExpr('0.1+0.2'), 0.3);
  assert.equal(evalExpr('500+'), 500); // still typing
  assert.equal(evalExpr('108.5'), 108.5);
  assert.equal(evalExpr(''), undefined);
  assert.equal(evalExpr('5/0'), undefined);
  assert.equal(evalExpr('5++'), 5);
  assert.equal(evalExpr('abc'), undefined);
  assert.equal(isExpression('2000+1500'), true);
  assert.equal(isExpression('-200'), false);
  assert.equal(isExpression('1500.5'), false);
  assert.equal(isExpression('100-20'), true);
});
