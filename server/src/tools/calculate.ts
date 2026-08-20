export const definition = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression. Supports +, -, *, /, parentheses, ^ (power), sqrt, sin, cos, tan, log, pi, e.',
  input_schema: {
    type: 'object' as const,
    properties: {
      expression: {
        type: 'string',
        description: 'The mathematical expression to evaluate (e.g., "2 + 3 * 4", "sqrt(16)", "sin(pi/2)")',
      },
    },
    required: ['expression'],
  },
};

class Parser {
  private pos = 0;
  private expr: string;

  constructor(expr: string) {
    this.expr = expr.replace(/\s+/g, '');
  }

  parse(): number {
    const result = this.parseAddSub();
    if (this.pos < this.expr.length) {
      throw new Error(`Unexpected character: ${this.expr[this.pos]}`);
    }
    return result;
  }

  private parseAddSub(): number {
    let left = this.parseMulDiv();
    while (this.pos < this.expr.length) {
      const op = this.expr[this.pos];
      if (op !== '+' && op !== '-') break;
      this.pos++;
      const right = this.parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private parseMulDiv(): number {
    let left = this.parsePower();
    while (this.pos < this.expr.length) {
      const op = this.expr[this.pos];
      if (op !== '*' && op !== '/') break;
      this.pos++;
      const right = this.parsePower();
      if (op === '/' && right === 0) throw new Error('Division by zero');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private parsePower(): number {
    let base = this.parseUnary();
    while (this.pos < this.expr.length && this.expr[this.pos] === '^') {
      this.pos++;
      const exp = this.parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  private parseUnary(): number {
    if (this.expr[this.pos] === '-') {
      this.pos++;
      return -this.parseAtom();
    }
    if (this.expr[this.pos] === '+') {
      this.pos++;
    }
    return this.parseAtom();
  }

  private parseAtom(): number {
    const funcNames = ['sqrt', 'sin', 'cos', 'tan', 'log'];
    for (const fn of funcNames) {
      if (this.expr.startsWith(fn, this.pos)) {
        this.pos += fn.length;
        if (this.expr[this.pos] !== '(') {
          throw new Error(`Expected '(' after ${fn}`);
        }
        this.pos++; // skip (
        const arg = this.parseAddSub();
        if (this.expr[this.pos] !== ')') {
          throw new Error(`Expected ')' after ${fn} argument`);
        }
        this.pos++; // skip )
        switch (fn) {
          case 'sqrt': return Math.sqrt(arg);
          case 'sin': return Math.sin(arg);
          case 'cos': return Math.cos(arg);
          case 'tan': return Math.tan(arg);
          case 'log': return Math.log(arg);
        }
      }
    }

    if (this.expr.startsWith('pi', this.pos)) {
      this.pos += 2;
      return Math.PI;
    }

    if (this.expr[this.pos] === 'e' && (this.pos + 1 >= this.expr.length || !/[a-zA-Z]/.test(this.expr[this.pos + 1]))) {
      this.pos++;
      return Math.E;
    }

    if (this.expr[this.pos] === '(') {
      this.pos++; // skip (
      const result = this.parseAddSub();
      if (this.expr[this.pos] !== ')') {
        throw new Error('Mismatched parentheses');
      }
      this.pos++; // skip )
      return result;
    }

    const numMatch = this.expr.slice(this.pos).match(/^(\d+\.?\d*)/);
    if (numMatch) {
      this.pos += numMatch[1].length;
      return parseFloat(numMatch[1]);
    }

    throw new Error(`Unexpected token at position ${this.pos}: "${this.expr.slice(this.pos, this.pos + 5)}"`);
  }
}

export async function execute(input: { expression: string }) {
  try {
    const parser = new Parser(input.expression);
    const result = parser.parse();

    return {
      expression: input.expression,
      result: Number.isInteger(result) ? result : parseFloat(result.toFixed(10)),
    };
  } catch (error: any) {
    return { error: `Calculation failed: ${error.message}` };
  }
}
