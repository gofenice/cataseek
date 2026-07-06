<div class="cataseek-admin-tabs" style="margin-bottom: 20px;">
    <ul class="nav nav-tabs" role="tablist">
        <li class="active" style="cursor: pointer;"><a href="#cataseek-config" role="tab" data-toggle="tab"><i class="icon-cogs"></i> {l s='Cataseek AI Search Configuration' mod='cataseek'}</a></li>
        <li style="cursor: pointer;"><a href="#cataseek-sync" role="tab" data-toggle="tab"><i class="icon-refresh"></i> {l s='Bulk Product Sync' mod='cataseek'}</a></li>
    </ul>

    <div class="tab-content" style="margin-top: 15px;">
        <!-- Config Tab -->
        <div class="tab-pane active" id="cataseek-config">
            {$form_html}
        </div>

        <!-- Sync Tab -->
        <div class="tab-pane" id="cataseek-sync">
            <div class="panel" id="cataseek-sync-panel" style="border-top: none; box-shadow: none;">
                <div class="panel-body">
                    <div class="row">
                        <div class="col-md-8">
                            <p>{l s='Synchronize all products from your catalog to Cataseek. This process will run in batches to avoid timeouts.' mod='cataseek'}</p>
                            
                            <div id="sync-status" class="alert" style="display:none; margin-top: 15px;">
                                <span id="sync-message"></span>
                            </div>
                            
                            <div class="progress" id="sync-progress" style="display:none; margin-top: 15px;">
                                <div class="progress-bar progress-bar-striped active" role="progressbar" 
                                     aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%">
                                    <span class="sr-only">0% Complete</span>
                                </div>
                            </div>
                            
                            <div style="margin-top: 15px;">
                                <button type="button" class="btn btn-primary btn-lg" id="btn-test-connection">
                                    <i class="icon-plug"></i> {l s='Test API Connection' mod='cataseek'}
                                </button>
                                
                                <button type="button" class="btn btn-success btn-lg" id="btn-bulk-sync">
                                    <i class="icon-refresh"></i> {l s='Start Bulk Sync' mod='cataseek'}
                                </button>
                            </div>
                        </div>
                        <div class="col-md-4">
                            <div class="panel panel-info">
                                <div class="panel-heading">{l s='Sync Statistics' mod='cataseek'}</div>
                                <div class="panel-body">
                                    <p><strong>{l s='Total Products:' mod='cataseek'}</strong> <span id="total-products">-</span></p>
                                    <p><strong>{l s='Synced:' mod='cataseek'}</strong> <span id="synced-products">0</span></p>
                                    <p><strong>{l s='Status:' mod='cataseek'}</strong> <span id="sync-status-text">{l s='Ready' mod='cataseek'}</span></p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script type="text/javascript">
$(document).ready(function() {
    var ajaxUrl = '{$ajax_url|escape:'javascript':'UTF-8'}';
    var totalProducts = 0;
    var syncedProducts = 0;
    var isSyncing = false;

    // Test API Connection
    $('#btn-test-connection').click(function() {
        var btn = $(this);
        btn.prop('disabled', true);
        btn.html('<i class="icon-spinner icon-spin"></i> {l s='Testing...' mod='cataseek'}');

        $.ajax({
            url: ajaxUrl,
            type: 'POST',
            data: {
                ajax: true,
                action: 'TestConnection'
            },
            success: function(response) {
                console.log('Cataseek Connection Test Response:', response);
                var data;
                try {
                    data = JSON.parse(response);
                    showSyncStatus(data.success ? 'success' : 'danger', data.message);
                } catch (e) {
                    console.error('Invalid JSON response in Connection Test:', response);
                    showSyncStatus('danger', '{l s='Invalid server response during connection test' mod='cataseek'}');
                }
                btn.prop('disabled', false);
                btn.html('<i class="icon-plug"></i> {l s='Test API Connection' mod='cataseek'}');
            },
            error: function(xhr, status, error) {
                console.error('Cataseek Connection Test Error:', status, error, xhr.responseText);
                showSyncStatus('danger', '{l s='Connection test failed: ' mod='cataseek'}' + error);
                btn.prop('disabled', false);
                btn.html('<i class="icon-plug"></i> {l s='Test API Connection' mod='cataseek'}');
            }
        });
    });

    // Get total products count on page load
    $.ajax({
        url: ajaxUrl,
        type: 'POST',
        data: {
            ajax: true,
            action: 'GetProductCount'
        },
        success: function(response) {
            console.log('Cataseek GetProductCount Response:', response);
            var data;
            try {
                data = JSON.parse(response);
            } catch (e) {
                console.error('Invalid JSON response in GetProductCount:', response);
                return;
            }
            if (data.success) {
                totalProducts = data.total;
                $('#total-products').text(totalProducts);
            }
        },
        error: function(xhr, status, error) {
            console.error('Cataseek GetProductCount Error:', status, error, xhr.responseText);
        }
    });

    // Bulk Sync
    $('#btn-bulk-sync').click(function() {
        if (isSyncing) {
            return;
        }

        if (!confirm('{l s='Are you sure you want to start the bulk sync? This may take several minutes.' mod='cataseek'}')) {
            return;
        }

        isSyncing = true;
        syncedProducts = 0;
        $(this).prop('disabled', true);
        $('#sync-progress').show();
        $('#sync-status-text').text('{l s='Syncing...' mod='cataseek'}');
        
        syncBatch(0);
    });

    function syncBatch(offset) {
        $.ajax({
            url: ajaxUrl,
            type: 'POST',
            data: {
                ajax: true,
                action: 'BulkSync',
                offset: offset
            },
            success: function(response) {
                console.log('Cataseek Sync Response:', response);
                var data;
                try {
                    data = JSON.parse(response);
                } catch (e) {
                    console.error('Invalid JSON response:', response);
                    completeSyncProcess(false, '{l s='Invalid server response during sync' mod='cataseek'}');
                    return;
                }
                
                if (data.success) {
                    syncedProducts += data.count;
                    $('#synced-products').text(syncedProducts);
                    
                    var progress = totalProducts > 0 ? Math.round((syncedProducts / totalProducts) * 100) : 0;
                    $('.progress-bar').css('width', progress + '%').attr('aria-valuenow', progress);
                    $('.progress-bar .sr-only').text(progress + '% Complete');
                    
                    showSyncStatus('info', data.message);
                    
                    if (!data.finished) {
                        // Continue with next batch
                        syncBatch(data.nextOffset);
                    } else {
                        // Sync completed
                        completeSyncProcess(true);
                    }
                } else {
                    completeSyncProcess(false, data.message);
                }
            },
            error: function(xhr, status, error) {
                console.error('Cataseek Sync Error:', status, error, xhr.responseText);
                completeSyncProcess(false, '{l s='A network error occurred during sync: ' mod='cataseek'}' + error);
            }
        });
    }

    function completeSyncProcess(success, message) {
        isSyncing = false;
        $('#btn-bulk-sync').prop('disabled', false);
        $('#sync-status-text').text(success ? '{l s='Completed' mod='cataseek'}' : '{l s='Failed' mod='cataseek'}');
        
        if (success) {
            showSyncStatus('success', '{l s='Bulk sync completed successfully!' mod='cataseek'}');
            $('.progress-bar').removeClass('active');
        } else {
            showSyncStatus('danger', message || '{l s='Sync failed' mod='cataseek'}');
        }
    }

    function showSyncStatus(type, message) {
        $('#sync-status')
            .removeClass('alert-info alert-success alert-danger alert-warning')
            .addClass('alert-' + type)
            .show();
        $('#sync-message').text(message);
    }
});
</script>

<style>
#cataseek-sync-panel .progress {
    height: 30px;
}

#cataseek-sync-panel .progress-bar {
    line-height: 30px;
    font-size: 14px;
}

#cataseek-sync-panel .btn-lg {
    margin-right: 10px;
}

.panel-info .panel-body p {
    margin-bottom: 8px;
}
</style>