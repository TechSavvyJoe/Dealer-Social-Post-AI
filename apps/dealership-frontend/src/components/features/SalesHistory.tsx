import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { TranscriptDisplay } from './TranscriptDisplay';
import { PerformanceReportViewer } from './PerformanceReportViewer';
import {
  Search, Calendar, Clock, TrendingUp, Eye, Trash2,
  MessageSquare, BarChart3, FileText, Filter, SortAsc,
  SortDesc, ShoppingCart, Target, AlertCircle
} from 'lucide-react';
import { formatDate, formatDuration } from '../../lib/utils';
import { deleteSale } from '../../services/storageService';
import { useUIStore } from '../../stores/uiStore';
import type { SavedSale } from '../../types';

interface SalesHistoryProps {
  sales: SavedSale[];
  onSaleDeleted?: () => void;
}

type SortField = 'date' | 'duration' | 'score';
type SortDirection = 'asc' | 'desc';

export function SalesHistory({ sales, onSaleDeleted }: SalesHistoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSale, setSelectedSale] = useState<SavedSale | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'report'>('summary');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { addToast } = useUIStore();

  // Filter and sort sales
  const filteredSales = useMemo(() => {
    let filtered = sales;

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(sale =>
        sale.transcript.some(seg => seg.text.toLowerCase().includes(query)) ||
        sale.summary.toLowerCase().includes(query)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case 'duration':
          comparison = a.duration - b.duration;
          break;
        case 'score':
          comparison = (a.performanceReport?.overallScore || 0) - (b.performanceReport?.overallScore || 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [sales, searchQuery, sortField, sortDirection]);

  const handleViewSale = (sale: SavedSale) => {
    setSelectedSale(sale);
    setActiveTab('summary');
    setIsDetailOpen(true);
  };

  const handleDeleteSale = async (saleId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    if (!confirm('Are you sure you want to delete this call record?')) return;

    try {
      deleteSale(saleId);
      addToast({
        title: 'Call deleted',
        description: 'The call record has been removed',
        type: 'success',
      });
      onSaleDeleted?.();
      if (selectedSale?.id === saleId) {
        setIsDetailOpen(false);
      }
    } catch (error) {
      console.error('Error deleting sale:', error);
      addToast({
        title: 'Delete failed',
        description: 'Could not delete the call record',
        type: 'error',
      });
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getScoreBadge = (score: number | undefined) => {
    if (!score) return <Badge variant="secondary">No Score</Badge>;
    if (score >= 80) return <Badge variant="default" className="bg-green-500">Excellent</Badge>;
    if (score >= 60) return <Badge variant="default" className="bg-blue-500">Good</Badge>;
    if (score >= 40) return <Badge variant="secondary">Fair</Badge>;
    return <Badge variant="destructive">Needs Work</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                Sales History
              </CardTitle>
              <CardDescription>
                {filteredSales.length} of {sales.length} calls
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search sales..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Sort Controls */}
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Sort by:</span>
            <Button
              size="sm"
              variant={sortField === 'date' ? 'default' : 'outline'}
              onClick={() => toggleSort('date')}
            >
              <Calendar className="w-3 h-3 mr-1" />
              Date
              {sortField === 'date' && (
                sortDirection === 'asc' ? <SortAsc className="w-3 h-3 ml-1" /> : <SortDesc className="w-3 h-3 ml-1" />
              )}
            </Button>
            <Button
              size="sm"
              variant={sortField === 'duration' ? 'default' : 'outline'}
              onClick={() => toggleSort('duration')}
            >
              <Clock className="w-3 h-3 mr-1" />
              Duration
              {sortField === 'duration' && (
                sortDirection === 'asc' ? <SortAsc className="w-3 h-3 ml-1" /> : <SortDesc className="w-3 h-3 ml-1" />
              )}
            </Button>
            <Button
              size="sm"
              variant={sortField === 'score' ? 'default' : 'outline'}
              onClick={() => toggleSort('score')}
            >
              <TrendingUp className="w-3 h-3 mr-1" />
              Score
              {sortField === 'score' && (
                sortDirection === 'asc' ? <SortAsc className="w-3 h-3 ml-1" /> : <SortDesc className="w-3 h-3 ml-1" />
              )}
            </Button>
          </div>

          {/* Sales List */}
          {filteredSales.length === 0 ? (
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-sm text-muted-foreground">
                {searchQuery ? 'No sales match your search' : 'No sales history yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filteredSales.map((sale) => (
                  <motion.div
                    key={sale.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                      <CardContent className="p-4" onClick={() => handleViewSale(sale)}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            {/* Header Row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <Calendar className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium">
                                {formatDate(new Date(sale.timestamp))}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                <Clock className="w-3 h-3 mr-1" />
                                {formatDuration(sale.duration)}
                              </Badge>
                              {sale.performanceReport && getScoreBadge(sale.performanceReport.overallScore)}
                            </div>

                            {/* Summary Preview */}
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {sale.summary}
                            </p>

                            {/* Metadata */}
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                {sale.transcript.length} messages
                              </span>
                              {sale.performanceReport && (
                                <span className="flex items-center gap-1">
                                  <BarChart3 className="w-3 h-3" />
                                  {sale.performanceReport.steps.length} steps analyzed
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewSale(sale);
                              }}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => handleDeleteSale(sale.id, e)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedSale && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5" />
                    Sale Details
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      <Calendar className="w-3 h-3 mr-1" />
                      {formatDate(new Date(selectedSale.timestamp))}
                    </Badge>
                    <Badge variant="outline">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDuration(selectedSale.duration)}
                    </Badge>
                  </div>
                </div>
              </DialogHeader>

              {/* Tabs */}
              <div className="border-b">
                <div className="flex gap-4">
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
                      activeTab === 'summary'
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <FileText className="w-4 h-4 inline mr-1" />
                    Summary
                    {activeTab === 'summary' && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                      />
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('transcript')}
                    className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
                      activeTab === 'transcript'
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 inline mr-1" />
                    Transcript
                    {activeTab === 'transcript' && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                      />
                    )}
                  </button>
                  {selectedSale.performanceReport && (
                    <button
                      onClick={() => setActiveTab('report')}
                      className={`pb-2 px-1 text-sm font-medium transition-colors relative ${
                        activeTab === 'report'
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <BarChart3 className="w-4 h-4 inline mr-1" />
                      Performance
                      {activeTab === 'report' && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                        />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Tab Content */}
              <div className="mt-6">
                <AnimatePresence mode="wait">
                  {activeTab === 'summary' && (
                    <motion.div
                      key="summary"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">AI Summary</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm whitespace-pre-wrap">{selectedSale.summary}</p>
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}

                  {activeTab === 'transcript' && (
                    <motion.div
                      key="transcript"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">Call Transcript</CardTitle>
                          <CardDescription>
                            {selectedSale.transcript.length} messages
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <TranscriptDisplay segments={selectedSale.transcript} />
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}

                  {activeTab === 'report' && selectedSale.performanceReport && (
                    <motion.div
                      key="report"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <PerformanceReportViewer report={selectedSale.performanceReport} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
