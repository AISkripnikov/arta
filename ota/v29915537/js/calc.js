/* Простой инженерный калькулятор с разбором выражений (без eval).
 * Тригонометрия работает в делениях угломера: 6000 дел. = 360°.
 */
(function (root) {
  'use strict';
  var MIL = 2 * Math.PI / 6000;

  var FUNCS = {
    'sin': function (x) { return Math.sin(x * MIL); },
    'cos': function (x) { return Math.cos(x * MIL); },
    'tan': function (x) { return Math.tan(x * MIL); },
    'atan': function (x) { return Math.atan(x) / MIL; },
    'asin': function (x) { return Math.asin(x) / MIL; },
    '√': function (x) { return Math.sqrt(x); }
  };

  function evaluate(src) {
    var s = src.replace(/\s+/g, ''), i = 0;
    function peek() { return s[i]; }
    function expr() {
      var v = term();
      while (peek() === '+' || peek() === '−' || peek() === '-') {
        var op = s[i++], r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function term() {
      var v = unary();
      while (peek() === '×' || peek() === '÷' || peek() === '*' || peek() === '/') {
        var op = s[i++], r = unary();
        v = (op === '×' || op === '*') ? v * r : v / r;
      }
      return v;
    }
    function unary() {
      if (peek() === '−' || peek() === '-') { i++; return -unary(); }
      return power();
    }
    function power() {
      var v = atom();
      while (peek() === '²') { i++; v = v * v; }
      return v;
    }
    function atom() {
      var c = peek();
      if (c === '(') { i++; var v = expr(); if (peek() === ')') i++; return v; }
      for (var name in FUNCS) {
        if (s.substr(i, name.length) === name) {
          i += name.length;
          var arg;
          if (peek() === '(') { i++; arg = expr(); if (peek() === ')') i++; }
          else arg = power();
          return FUNCS[name](arg);
        }
      }
      var m = /^\d*\.?\d+/.exec(s.slice(i)) || /^\d+\.?/.exec(s.slice(i));
      if (!m) throw new Error('syntax');
      i += m[0].length;
      return parseFloat(m[0]);
    }
    var res = expr();
    if (i < s.length) throw new Error('syntax');
    return res;
  }

  root.Calc = { evaluate: evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
