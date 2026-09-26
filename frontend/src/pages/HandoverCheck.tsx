import { useMemo } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Row, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import FilterBar from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import RecoveryBadge from '../components/common/RecoveryBadge';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import { useBoxStore } from '../stores/boxStore';
import { useLithoStore } from '../stores/lithoStore';
import {
  buildHandoverReport,
  HANDOVER_CSV_COLUMNS,
  HANDOVER_RULE_VERSION,
  HANDOVER_RULES,
  HANDOVER_VERDICTS,
  toHandoverCsvRows,
  VERDICT_META,
} from '../utils/handover';
import { downloadCsv } from '../utils/export';
import type { HoleHandover } from '../types/handover';

const { Title, Paragraph, Text } = Typography;

/** 覆盖情况单元格：完整标绿，断档标红并提示区间 */
function CoverageCell({ count, unit, gaps }: { count: number; unit: string; gaps: Array<{ from: number; to: number }> }) {
  if (gaps.length === 0) {
    return <Text type="success">{count} {unit} · 覆盖完整</Text>;
  }
  return (
    <Tooltip title={`断档区间：${gaps.map((gap) => `${gap.from}~${gap.to}m`).join('、')}`}>
      <Text type="danger">
        {count} {unit} · 断档 {gaps.length} 段
      </Text>
    </Tooltip>
  );
}

/** 交接体检：按孔汇总回次覆盖 / 箱位 / 采取率 / 岩性覆盖，给出阻断 / 待补 / 可交接结论 */
export default function HandoverCheck() {
  const { message } = AntApp.useApp();
  const holes = useHoleStore((s) => s.holes);
  const runs = useRunStore((s) => s.runs);
  const boxes = useBoxStore((s) => s.boxes);
  const lithos = useLithoStore((s) => s.lithos);
  const [params] = useSearchParams();

  // 任一业务表变化都会触发重算，结论即时刷新
  const report = useMemo(() => buildHandoverReport(holes, runs, boxes, lithos), [holes, runs, boxes, lithos]);

  const keyword = (params.get('kw') ?? '').trim().toLowerCase();
  const verdictFilter = params.get('verdict') ?? '';
  const filtered = useMemo(
    () =>
      report.filter((item) => {
        if (verdictFilter && item.verdict !== verdictFilter) return false;
        if (keyword) {
          const haystack = `${item.hole.holeNo} ${item.hole.rigNo} ${item.hole.shift}`.toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      }),
    [report, keyword, verdictFilter],
  );

  const blocked = report.filter((item) => item.verdict === '阻断');
  const pending = report.filter((item) => item.verdict === '待补');
  const ready = report.filter((item) => item.verdict === '可交接');
  const anomalyTotal = report.reduce((sum, item) => sum + item.anomalyCount, 0);

  const exportCsv = () => {
    const checkedAt = new Date().toISOString();
    downloadCsv(
      `gbdrillcore-handover-${checkedAt.slice(0, 10)}.csv`,
      toHandoverCsvRows(filtered, checkedAt),
      HANDOVER_CSV_COLUMNS,
    );
    message.success(`已导出 ${filtered.length} 条交接体检归档（规则 ${HANDOVER_RULE_VERSION}）`);
  };

  const columns: TableColumnsType<HoleHandover> = [
    {
      title: '孔号',
      width: 110,
      render: (_, item) => (
        <>
          <Text strong>{item.hole.holeNo}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item.hole.rigNo} · {item.hole.shift}
          </Text>
        </>
      ),
    },
    {
      title: '交接结论',
      width: 100,
      render: (_, item) => <Tag color={VERDICT_META[item.verdict].color}>{item.verdict}</Tag>,
    },
    { title: '已钻深度(m)', width: 100, align: 'right', render: (_, item) => item.reachedDepth },
    {
      title: '回次覆盖',
      width: 150,
      render: (_, item) => <CoverageCell count={item.runCount} unit="个回次" gaps={item.runGaps} />,
    },
    {
      title: '箱位覆盖',
      width: 150,
      render: (_, item) => {
        const capacityShort = item.issues.some((issue) => issue.category === '箱位不足' && issue.message.includes('容量不足'));
        if (capacityShort) {
          return <Text type="danger">{item.boxCount} 箱 · 格位容量不足</Text>;
        }
        return <CoverageCell count={item.boxCount} unit="箱" gaps={item.boxGaps} />;
      },
    },
    {
      title: '岩性覆盖',
      width: 150,
      render: (_, item) => <CoverageCell count={item.lithoCount} unit="段" gaps={item.lithoGaps} />,
    },
    {
      title: '平均采取率',
      width: 150,
      render: (_, item) => (
        <Space size={4} direction="vertical">
          <RecoveryBadge recovery={item.averageRecovery} />
          {item.anomalyCount > 0 ? (
            <Text type="danger" style={{ fontSize: 12 }}>
              {item.anomalyCount} 个异常回次
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '问题明细',
      render: (_, item) =>
        item.issues.length ? (
          <Space size={4} direction="vertical">
            {item.issues.map((issue, index) => (
              <Text key={index} type={issue.level === '阻断' ? 'danger' : 'warning'}>
                <Tag color={issue.level === '阻断' ? 'red' : 'orange'}>{issue.category}</Tag>
                {issue.message}
              </Text>
            ))}
          </Space>
        ) : (
          <Text type="success">资料齐全，可随箱交接</Text>
        ),
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: () => (
        <Space size={2}>
          <Link to="/runs">
            <Button size="small" type="link">
              回次
            </Button>
          </Link>
          <Link to="/boxes">
            <Button size="small" type="link">
              装箱
            </Button>
          </Link>
          <Link to="/lithology">
            <Button size="small" type="link">
              岩性
            </Button>
          </Link>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        交接体检
      </Title>
      <Paragraph type="secondary">
        交班前按孔汇总回次覆盖、箱位、采取率与岩性编录四类检查，判定钻孔资料能否随箱交接；记录变动后自动重算，可按结论筛选并导出归档
        CSV。
      </Paragraph>

      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message={`判定规则（${HANDOVER_RULE_VERSION}）`}
        description={
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {HANDOVER_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="阻断" value={blocked.length} unit="孔" status={blocked.length ? 'error' : 'success'} hint="回次断档或箱位不足，不可交接" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="待补" value={pending.length} unit="孔" status={pending.length ? 'warning' : 'success'} hint="采取率偏低或岩性空白，补齐后可交接" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="可交接" value={ready.length} unit="孔" status="success" hint="四类检查全部通过" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="采取率异常回次" value={anomalyTotal} unit="个" status={anomalyTotal ? 'error' : 'success'} hint="全矿区采取率 < 75% 的回次合计" />
        </Col>
      </Row>

      <FilterBar
        fields={[{ key: 'verdict', label: '结论', options: HANDOVER_VERDICTS, width: 110 }]}
        keywordPlaceholder="搜索孔号 / 钻机 / 班组"
        resultCount={filtered.length}
        totalCount={report.length}
        extra={
          <Button type="primary" icon={<DownloadOutlined />} onClick={exportCsv} disabled={filtered.length === 0}>
            导出归档CSV
          </Button>
        }
      />

      {report.length === 0 ? (
        <EmptyPanel description="暂无钻孔，请先在钻孔台帐建孔" />
      ) : (
        <Card size="small" title={`逐孔交接结论（规则 ${HANDOVER_RULE_VERSION}）`}>
          <Table
            rowKey={(item) => item.hole.id}
            size="small"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            scroll={{ x: 1400 }}
            locale={{ emptyText: '当前筛选条件下无匹配钻孔' }}
          />
        </Card>
      )}
    </div>
  );
}
