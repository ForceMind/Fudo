interface RulesScreenProps {
  onBack: () => void;
}

const rules = [
  '4 名玩家，每人 4 枚棋子，先让 4 枚棋子全部回家者获胜。',
  '掷骰后必须按当前行动力走到合法落点，路径不能折返，不能进入他人出生区或目标区。',
  '路径经过加速格会即时 +1 行动力，经过陷阱格会即时 -1 行动力。',
  '只有刚好停在传送门时才触发传送，立即到达成对传送门另一端。',
  '普通安全格允许所有棋子进入，不会被吃；中心争夺区只允许当前占据方进入。',
  '进入本方家门区后不能再离开，每个家位只能容纳一枚本方棋子。',
];

export function RulesScreen({ onBack }: RulesScreenProps) {
  return (
    <main className="menu-screen">
      <section className="screen-card rules-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">玩法说明</p>
            <h2>Dice Arena 规则</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onBack}>
            返回
          </button>
        </div>
        <div className="rule-grid">
          {rules.map((rule, index) => (
            <div className="rule-item" key={rule}>
              <span>{index + 1}</span>
              <p>{rule}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
