// ============================================================
// RETARDS & ALERTES
// ============================================================

function renderRetards() {
  const d = (typeof getRowsForKpi === 'function') ? getRowsForKpi() : FILTERED;
  const retardTypes = ['Consultation','Envoi TCO','Validation Filiale','Validation Comité','Signature BC','Livraison'];
  const retardCounts = {};
  retardTypes.forEach(t => retardCounts[t] = 0);
  const anomalyCounts = {};
  d.forEach(r => {
    if (!r._hasAnomalies && r._retards.length > 0) {
      const lastRetard = r._retards[r._retards.length - 1];
      if(retardCounts[lastRetard.type]!==undefined) retardCounts[lastRetard.type]++;
    }
    r._anomalies.forEach(a => { anomalyCounts[a.type] = (anomalyCounts[a.type]||0) + 1; });
  });
  const anomalyTypes = Object.keys(anomalyCounts).sort();
  const critCounts = {'Normal':0,'Attention':0,'Critique':0,'Très Critique':0};
  d.forEach(r => { critCounts[r._criticite] = (critCounts[r._criticite]||0)+1; });

  // ----- Un seul tableau regroupant Criticité + Retards par étape + Anomalies -----
  const critHeaders = ['Normal','Attention','Critique','Très Critique'];
  const critClass = {'Normal':'kpi-green','Attention':'kpi-yellow','Critique':'kpi-orange','Très Critique':'kpi-red'};
  const anomalyHeaders = anomalyTypes.length ? anomalyTypes : ['Aucune'];

  document.getElementById('statsRetard').innerHTML = `
    <thead>
      <tr class="kpi-group-row">
        <th colspan="${critHeaders.length}">Criticité</th>
        <th colspan="${retardTypes.length}">Retards par Étape (sans anomalie)</th>
        <th colspan="${anomalyHeaders.length}">Anomalies de Processus</th>
      </tr>
      <tr>
        ${critHeaders.map(c => `<th>${c}</th>`).join('')}
        ${retardTypes.map(t => `<th>${t}</th>`).join('')}
        ${anomalyHeaders.map(t => `<th title="${t}">${t.length>18?t.slice(0,18)+'…':t}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      <tr class="kpi-row-values">
        ${critHeaders.map(c => `<td class="${critClass[c]}">${critCounts[c]}</td>`).join('')}
        ${retardTypes.map(t => `<td class="kpi-red">${retardCounts[t]}</td>`).join('')}
        ${anomalyTypes.length
          ? anomalyTypes.map(t => `<td class="kpi-orange">${anomalyCounts[t]}</td>`).join('')
          : `<td>0</td>`}
      </tr>
    </tbody>
  `;

  drawChart('chartRetardType', 'bar', {
    labels: retardTypes,
    datasets: [{label:'Nb retards (sans anomalies)', data: retardTypes.map(t=>retardCounts[t]), backgroundColor:'#ef4444'}]
  }, {plugins:{legend:{display:false}}, scales:{y:{ticks:{color:'#94a3b8'}}, x:{ticks:{color:'#94a3b8',font:{size:10}}}}});
  const filialesCrit = {};
  d.forEach(r => {
    const f = r['filiale']||'?';
    if (!filialesCrit[f]) filialesCrit[f] = {'Normal':0,'Attention':0,'Critique':0,'Très Critique':0};
    filialesCrit[f][r._criticite]++;
  });
  const fKeys = Object.keys(filialesCrit);
  drawChart('chartCriticiteFiliale', 'bar', {
    labels: fKeys,
    datasets: [
      {label:'Normal', data: fKeys.map(f=>filialesCrit[f]['Normal']), backgroundColor:'#10b981'},
      {label:'Attention', data: fKeys.map(f=>filialesCrit[f]['Attention']), backgroundColor:'#f59e0b'},
      {label:'Critique', data: fKeys.map(f=>filialesCrit[f]['Critique']), backgroundColor:'#f97316'},
      {label:'Très Critique', data: fKeys.map(f=>filialesCrit[f]['Très Critique']), backgroundColor:'#ef4444'}
    ]
  }, {scales:{x:{stacked:true,ticks:{color:'#94a3b8'}},y:{stacked:true,ticks:{color:'#94a3b8'}}}, plugins:{legend:{labels:{color:'#94a3b8'}}}});
  const search = document.getElementById('searchRetard')?.value?.toLowerCase()||'';
  const retardRows = d.filter(r => r._hasRetard || r._hasAnomalies || r._criticite === 'Très Critique');
  const filtered = retardRows.filter(r => !search ||
    (r['designation_demandee']||'').toLowerCase().includes(search) ||
    (r['numero_da']||'').toString().toLowerCase().includes(search) ||
    (r['filiale']||'').toLowerCase().includes(search));
  document.getElementById('tbodyRetard').innerHTML = filtered.map(r => `
    <tr onclick="openModal(${r._idx})" style="cursor:pointer">
      <td>${r['numero_da']||'—'}</td>
      <td title="${r['designation_demandee']||''}">${(r['designation_demandee']||r['designation_commandee']||'—').slice(0,40)}</td>
      <td>${r['filiale']||'—'}</td>
      <td>${r['acheteur']||'—'}</td>
      <td>${statutBadge(r['statut'])}</td>
      <td>${critBadge(r._criticite)}</td>
      <td>${r._retards.map(x=>x.type).join(', ')||'—'}</td>
      <td style="color:var(--red);font-weight:700">${r._joursRetard > 0 ? r._joursRetard + 'j' : '—'}</td>
      <td>${r._anomalies.map(a => `<span class="badge badge-${a.criticite.toLowerCase().replace(' ', '-')}">${a.type.slice(0,25)}</span>`).join('<br>')||'—'}</td>
      <td>${prioBadge(r['priorite'])}</td>
    </tr>
  `).join('') || '<tr><td colspan="10" class="no-data">Aucun retard ou anomalie détecté</td></tr>';
}
function filterRetardTable() { renderRetards(); }