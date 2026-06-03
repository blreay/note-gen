'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { FileText, FolderOpen, HardDrive, Archive } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import useSettingStore from '@/stores/setting'
import { open } from '@tauri-apps/plugin-dialog'

export function LoggingSettings() {
  const t = useTranslations('settings.general.interface')
  const {
    logLevel, setLogLevel,
    logDir, setLogDir,
    logMaxFileSize, setLogMaxFileSize,
    logMaxFiles, setLogMaxFiles,
  } = useSettingStore()

  const handleSelectDir = async () => {
    const selected = await open({ directory: true })
    if (selected) {
      setLogDir(selected)
    }
  }

  return (
    <div className="space-y-4">
      {/* Log Level */}
      <Item variant="outline">
        <ItemMedia variant="icon"><FileText className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.level.title')}</ItemTitle>
          <ItemDescription>{t('logging.level.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={logLevel} onValueChange={setLogLevel}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="trace">Trace</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>

      {/* Log Directory */}
      <Item variant="outline">
        <ItemMedia variant="icon"><FolderOpen className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.dir.title')}</ItemTitle>
          <ItemDescription>{t('logging.dir.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <div className="flex items-center gap-2">
            <Input
              value={logDir}
              onChange={(e) => setLogDir(e.target.value)}
              placeholder={t('logging.dir.placeholder')}
              className="w-[240px]"
            />
            <Button variant="outline" size="icon" onClick={handleSelectDir}>
              <FolderOpen className="size-4" />
            </Button>
          </div>
        </ItemActions>
      </Item>

      {/* Max File Size */}
      <Item variant="outline">
        <ItemMedia variant="icon"><HardDrive className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.maxFileSize.title')}</ItemTitle>
          <ItemDescription>{t('logging.maxFileSize.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={String(logMaxFileSize)} onValueChange={(v) => setLogMaxFileSize(Number(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 MB</SelectItem>
              <SelectItem value="5">5 MB</SelectItem>
              <SelectItem value="10">10 MB</SelectItem>
              <SelectItem value="20">20 MB</SelectItem>
              <SelectItem value="50">50 MB</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>

      {/* Max File Count */}
      <Item variant="outline">
        <ItemMedia variant="icon"><Archive className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('logging.maxFiles.title')}</ItemTitle>
          <ItemDescription>{t('logging.maxFiles.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select value={String(logMaxFiles)} onValueChange={(v) => setLogMaxFiles(Number(v))}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
    </div>
  )
}
